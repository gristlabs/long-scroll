/**
 * LongScroll is a class that allows scrolling a very long list of rows by rendering only those
 * that are visible. Note that the elements rendered by longscroll should have box-sizing set to
 * border-box.
 */


import * as gr from 'grainjs';
import * as _ from 'underscore';
import { Observable, DomElementArg, Disposable } from 'grainjs';
import BinaryIndexedTree = require('./BinaryIndexedTree');
import {Scheduler, SchedulerEvent, TaskCancelledError} from './Scheduler';

let dom = gr.dom;

/**
 * Use the browser globals in a way that allows replacing them with mocks in tests.
 */
// var G = require('./browserGlobals').get('window', '$');


// DebugCanvas stuffs;

let debugEl = gr.styled('div',
  `
  position:fixed;
  top:0px; right: 0px;
  border:1px dashed violet;
  background-color:white;
  z-index:999;
  `
);

let debugCanvas = gr.styled('canvas',
  `
  display:block;
  clear:right;
  `
);


function showPromiseError(err: Error) {
    if(err instanceof TaskCancelledError) {
        // if a task is cancelled, that means that
        // whatever was working on it has been freed
        // so not actually a problem
        console.log("LongScroll: scheduler cancelled task due to freeing block");
    } else {
        throw err;
    }
}

//
function makeToggleButton(observable: gr.Observable<boolean>, ...rest: DomElementArg[]) {
  let toggleObs = ()=>{ observable.set(!observable.get());};
  return dom("input", gr.attr("type","button"), dom.on('click', toggleObs), ...rest);
}



// TODO Maybe should go into scheduler?
// Something
class AveragedValue {
  private samples = [] as number[];
  constructor(public readonly maxSamples: number) {}

  public addValue(v: number) {
    this.samples.push(v);
    if(this.samples.length >= this.maxSamples) 
      { this.samples.shift(); }
  }

  public clear(): void { this.samples = []; }
  public get(): number { 
    if(!this.samples.length) { throw Error("No samples yet in AveragedValue"); }
    let sum = 0;
    for(let i = 0; i < this.samples.length; i++) {
      sum += this.samples[i];
    }
    return sum / this.samples.length;
  }

  // counts how many samples
  public getNumSamples() { return this.samples.length; }
}

// Function that takes 


/* ------------- NOTE -----------
 * Some browsers (chrome) will suspend timer ticks sometimes
 * while scrolling or doing certain inputs, which is terrible
 * Animation frames arent affected, so this implements a
 * timer using those
 */
// TODO: this should probably also live in scheduler
// Ticks callback once per animationframe
class AnimationFrameTimer extends Disposable{
  private lastFrameAt = -1;
  private lastFrameDuration = -1;
  private averagedFrameTime: AveragedValue;

  // Handle to the last requested animationframe
  private timerHandle = -1;

  constructor (private cb: (...args:any[])=>any) {
    super();
    this.lastFrameAt = Date.now();
    this.averagedFrameTime = new AveragedValue(5); //average last 5 frames
  }

  private tick() {
    this.timerHandle = -1; // animation frame just finished

    const timeNow = Date.now();
    this.lastFrameDuration = timeNow - this.lastFrameAt;
    this.averagedFrameTime.addValue(this.lastFrameDuration);
    this.lastFrameAt = timeNow;

    try {
      this.cb();
    } finally  {
      this.queueTick();
    }
  }


  private queueTick() {
    if(this.timerHandle != -1)
      { cancelAnimationFrame(this.timerHandle);}

    this.timerHandle = requestAnimationFrame(() => this.tick());
  }

  public start() {
    this.lastFrameAt = Date.now();
    this.queueTick();
  }

  public stop() {
    this.lastFrameAt = -1;

    if(this.timerHandle != -1) {
      cancelAnimationFrame(this.timerHandle);
      this.timerHandle = -1;
    }
  }

  // Returns last frame duration or -1
  public getLastFrameDuration() {
    return this.lastFrameDuration;
  }

  public getAveragedFrameTime() {
    return this.averagedFrameTime.get();
  }

  public dispose() {
    this.stop();
  }
}


// Takes scroll positions at times
// keeps track of estimate of vel at current time
// generates
class VelTracker {
  /* Sudden jumps shouldnt be interpreted as shifts of velocity
   *
   * scroll events should be received every ~30 ms
   * If 50ms without a scroll event, start decaying vel estimate
   */

  private static jumpThreshold = 1000; //more than 1000px is interpreted as jump
  private static decayStartTime = 50; // after this many ms without a scroll, assumes we've stopped
  private static decayTime = 200; // smoothly vary velocity down until this long after last scroll

  private lastTime = 0;
  private lastPos = -1;
  private lastVel = 0;


  public onScroll(scrollPos: number) {
    const currTime = Date.now();

    // Does init the first time it's scrolled
    if(this.lastPos == -1) {
      this.lastTime = currTime;
      this.lastPos = scrollPos;
      return;
    }

    const delta = scrollPos - this.lastPos;
    const deltaT = Math.max(1, currTime - this.lastTime); //avoid div by 0

    if(delta > VelTracker.jumpThreshold) {
      console.log("JUMPED");
      //TODO: maybe put special logic here, because this prob shouldn't be interpreted 
      // as just moving very fast. It's discontinuous
    }

    const newVel = delta / deltaT;
    this.lastVel = (this.lastVel * 0.8 + newVel * 0.2);
    this.lastTime = currTime;
    this.lastPos = scrollPos;
  }

  public getVel(): number { // in pixels per ms
    const deltaT = Date.now() - this.lastTime;

    if(deltaT < VelTracker.decayStartTime) {
      return this.lastVel;
    }

    else {

      if(deltaT >= VelTracker.decayTime) { this.lastVel = 0; return 0; }

      return this.lastVel * (1 - deltaT / VelTracker.decayTime);
    }
  }
}



export interface LongScrollDataSource {
  length: number;

  //getRow(i: number): T; // returns a reference to the row element?

  makeDom(index: number): Element;

  //makes simple dom to prevent white-flash
  //simple dom should be of given height in pixels
  makeDummyDom(index: number): Element;

  //TODO also add reassign
  freeDom(index: number, elm: Element): void;
  freeDummyDom(index: number, elm: Element): void;
}


export class Range {
  private _top:number;
  private _bottom: number;

  // Helper for functions overloaded to Range | (number, number)
  public static unify(a: number, b: number): Range;
  public static unify(a: Range, b: undefined): Range;
  public static unify(a: number|Range, b?: number): Range{
    if(a instanceof Range) {
      return a;
    } else {
      return new Range(a, b as number);
    }
  }


  constructor(t:number, b:number){
    if(t > b) { throw Error("Can't create range where top > bottom"); }
    if(Number.isNaN(t) || Number.isNaN(b)) { throw Error("Trying to create NaN range"); }
    this._top = t;
    this._bottom = b;
  }

  get top() { return this._top; }
  get bot() { return this._bottom; }
  get height() { return this._bottom - this._top; }

  public toString() {
    return `Range(${this.top}, ${this.bot})`;
  }

  public forEach(f: (i:number, offset:number)=>void): void {
    for(let i = this.top; i < this.bot; i++) {
      f(i, i - this.top);
    }
  }


  // For number, should be contained within it
  // For range, range must be a subset of this
  // Empty ranges are always contained
  public contains(r: Range): boolean;
  public contains(i: number): boolean;
  public contains(a: Range|number) {
    if(typeof a == "number") {
      return a >= this.top && a < this.bot;
    } else {
      if(a.height == 0) { return true; }
      return this.contains(a.top) && this.contains(a.bot - 1);
    }
  }


  public equals(other: Range) {
    return this.top == other.top && this.bot == other.bot;
  }

  // Returns this range, clamped to fit within other
  public clampTo(t: number, b: number): Range;
  public clampTo(other: Range): Range;
  public clampTo(a: number|Range, b?:number): Range {
    // overload helper
    const other = Range.unify(a as any, b as any);

    const r = new Range(this.top, this.bot);
    if(other.top > r.top) { r._top = other._top; }
    if(other.bot < r.bot) { r._bottom = other._bottom; }
    if(r.top > r.bot){ r._top = r._bottom; }
    return r;
  }

  //returns i clamped to fit within this
  public clampNum(i: number): number {
    if(i < this.top) { return this.top; }
    if(i > this.bot) { return this.bot - 1; }
    return i;
  }
}

interface BlockSet {
    setTarget(range: Range, startFrom: number): void;
    getBlocks(): Block[];
    getCoveredRange(): Range;

    debug(): void;

    render(): void; //sets its blocks to render

    doWork(evt: SchedulerEvent): void; // schedules it to do some work
    //ultimately should do like, requestidleframe or something?

    updateRowSize(rows: Array<{index: number, newSize: number}>): void;
}

interface Block {
  // Render stuff (needs to support partial render
  // to prevent flashing )

  prepare(): void; //makes DOM (internal, no render), (might be slow)

  updatePos(): void; //repositions itself to match rowheights

  // Returns whether proper dom is prepared
  isPrepared(): boolean;
  isDirty(): boolean;

  render(): void;

  // Which rows it handles
//  setRange(r: Range): void; TODO: NOT NEEDED ANYMORE?
  getRange(): Range;


  //Removes block from DOM
  //frees its dom contents??
  //MAYBE
  free(): void;
  // Where it is on the grid
  // get absPxRange
  // get vpPxRange
}


class LongScrollDom {
  constructor(
    public container: HTMLElement,
    public scrollDiv: HTMLElement,
  ) {}
}

export class LongScroll extends Disposable{
  private data: LongScrollDataSource;
  private dom: LongScrollDom|null = null;

  private debug: DebugCanvas;

  private blocks: BlockSet;

  private vel: VelTracker;
  public timer: AnimationFrameTimer;

  public scheduler: Scheduler;

  private rowHeights: BinaryIndexedTree;

  // ===== Constants ======
  
  // Initial block size in rows
  private initialBlockSize = 19; // TODO make this better

  // we would like to shrink blocks to keep block prepare time below this number (ms)
  private preferredBlockTime = 12; 

  // dont shrink below this
  private minBlockSize = 5; // TODO make this better (dynamic)





  // represents dom for a set of rows
  // Attaches itself to longscroll's scroll div on creation
  private static BlockImpl = class BlockImpl implements Block{

    private blockDiv: HTMLElement;
    private range: Range;


    // dom elements for actual data
    // created asynchronously
    private doms: Element[] | null = null; //real doms, null if mot prepared

    // dummy dom elements, created immediately
    private dummyDoms: Element[];

    // set when element needs to be resized
    // or doms reattached
    public dirty = false;

    public isDirty() { return this.dirty; }
    public isPrepared() { return this.doms != null; }


    constructor(
        public longscroll: LongScroll,
        range:Range) 
    {

      this.range = range;

      this.blockDiv = dom('div#blockdiv',
          gr.style("position", "absolute"),
          gr.style("display", "flex"),
          gr.style("flex-direction", "column"),
          gr.style("will-change", "transform"),
        )

      this.longscroll.scheduler.scheduleWrite(this).then(()=>{
        this.longscroll.dom!.scrollDiv.appendChild(this.blockDiv);
      })
      .catch((err) => { showPromiseError(err); });

      this.dummyDoms = this.prepareDummyDoms();
    }

    public getDom() { return this.blockDiv; }

    public getRange() { return this.range; }



    private prepareDummyDoms(): Element[]{
      console.log("Preparing dummy doms for " + this);

      // TODO: use free list
      this.dirty = true;

      const doms: Element[] = [];
      this.range.forEach((i, offset) => {
        const d = this.longscroll.data.makeDummyDom(i);
        gr.styleElem(d, "height", this.longscroll.getRowHeight(i) + "px");
        doms.push(d);
      });

      return doms;
    }

    public prepare() {
      console.log("Preparing real doms for " + this);

      this.doms = [];
      this.range.forEach((i, offset) => {
          const d = this.longscroll.data.makeDom(i);
          if(! (d instanceof Node)) { throw Error("makeDom returned nonRow"); }
          this.doms![offset] = d;

        // TODO: free list, else reuse existing rows maybe?
      });

      this.dirty = true;
      // TODO: do this by event maybe? (to notify blockset and longscroll)
    }

    // Moves it offscreen
    public measure() {
      if(this.doms == null) { throw Error("Can only measure rows if they're already prepared"); }

      //this.blockDiv.style.visibility = "hidden";

      const rowHeights = []
      const firstRow = this.getRange().top;

      for(let offset = 0; offset < this.doms.length; offset++) {
        const rowIndex = firstRow + offset;
        const oldHeight = this.longscroll.getRowHeight(rowIndex);
        const rowDom = this.doms[offset];
        const rowHeight = rowDom.getBoundingClientRect().height;

        const dummyDom = this.dummyDoms[offset];

        //only update rowheights if the height of the row actually changed
        if(rowHeight != oldHeight) {
          //TODO, maybe updating the dummy dom height should be done centralized
          this.longscroll.scheduler.scheduleWrite(this)
            .then(() => gr.styleElem(dummyDom, "height", rowHeight + "px"))
            .catch((err) => { showPromiseError(err); });

          rowHeights.push({index: rowIndex, newSize:rowHeight});
        }

      }

      //console.log(rowHeights);
      // TODO: batch this
      
      // only update if rows actually changed size
      if(rowHeights.length)
      {this.longscroll.updateRowSize(rowHeights);}
    }

    /* Creates dom for all rows if needed
     * Clears block div, inserts row dom
     * Positions block div if necessary
     */
    public async render() {
      try {
        // Update blockDiv contents if needed
        if(this.dirty) {
          console.log("rendering dirty " + this.toString());
          this.dirty = false;

          //Cache this now, it applies to this render operation
          //May change by the time we get to the later portions
          const isDummyRender = this.doms === null;

          const frag = document.createDocumentFragment();

          if(isDummyRender) {
            this.range.forEach((i, offset) => {
              frag.appendChild(this.dummyDoms[offset] as Element);
            });
          } else {
            //Only have dummies
            this.range.forEach((i, offset) => {
              frag.appendChild(this.doms![offset] as Element);
            });
          }

          await this.longscroll.scheduler.scheduleIdleWrite(this); // schedules us a write

          this.blockDiv.innerHTML = "";
          this.blockDiv.appendChild(frag);
          this.updatePos();

          await this.longscroll.scheduler.scheduleRead(this);

          // If we just rendered the real thing
          if(!isDummyRender) { 
            if(this.doms![0].getBoundingClientRect().height == 0) {
              console.log("AAAAA");
            }
            this.measure(); 
          }

          // Reposition blockDiv

          //dom.styleElem(this.blockDiv, "top", this.longscroll.getRowTop(this.range.top) + "px");
          //console.log(`block: ${block.top - scr.top}, ${block.bottom - scr.top}`);

        }

      } catch (err) {
        //task cancelled
        showPromiseError(err);
        console.log("Block freed mid-render");
      }
    }

    public updatePos() {
        //dom.styleElem(this.blockDiv, "top", this.longscroll.getRowTop(this.range.top) + "px");
        dom.styleElem(this.blockDiv, "transform", "translateY(" + this.longscroll.getRowTop(this.range.top) + "px" + ")");
    }



    public toString() {
      const r = this.range;
      return `Block(${r.top}, ${r.bot}, Prepped: ${this.isPrepared()?"T":"F"})`;
    }

    public free() {
      // TODO: free the rest of it
      // this.blockDiv.style.visibility = "hidden";
      
      // Let datasource free the doms itself
      this.range.forEach((i, offset) => {
        this.longscroll.data.freeDummyDom(i, this.dummyDoms[offset]);

        if(this.doms) 
        { this.longscroll.data.freeDom(i, this.doms[offset]); }
      });

      // Free our div
      dom.domDispose(this.blockDiv);
      //this.blockDiv.parentNode!.removeChild(this.blockDiv);
      if(this.blockDiv.parentNode)
      { this.blockDiv.outerHTML = ""; }

      //Cancel any pending work by this (mid-render, etc)
      this.longscroll.scheduler.cancelJobs(this);
    }

  }; // End of BlockImpl


  // ====== BlockSetImpl
  //
  // Handles maintaining a list of blocks corresponding to some contiguous set of rows
  // Handles creating, freeing, and moving around blocks to maintain some rendered portion
  // Will do best effort to render first dummy rows, then real rows
  // If given buffer size and direction, will handle predictive buffering
  //    (buffer more towards where we're scrolling)
  //
  // Should also handle resizes, and pass pixel shifts on to blocks when needed
  // LongScroll and Blocks themselves handle actual rendering and pixel-counting for the most part

  private static BlockSetImpl = class BlockSetImpl implements BlockSet {

    // Invariant: blocks should be contiguous and in order
    private blocks: Block[] = [];

    private targetRow: number; // which row to start rendering from
    private targetRange: Range; //range to ensure is covered by blocks
    private leaveRange: Range; //range where we should leave blocks and not free them


    private preferredBlockSize:number; // TODO make this better


    constructor(private longscroll: LongScroll) {
      this.preferredBlockSize = this.longscroll.initialBlockSize;
    }

    // Updates the range which this should keep covered
    // If already covered, noop
    public setTarget(range: Range, startFrom: number) {
      this.targetRow = startFrom;
      this.targetRange = range;

      // leaveRange: for Now just make it double the size of the targetRange,
      // centered on targetRange
      const height = range.height;
      const newTop = Math.round(range.top - height/3);
      const newBot = Math.round(range.bot + height/3);

      this.leaveRange = new Range(newTop, newBot).clampTo(0, this.longscroll.data.length);

      this.ensureCovers()
            .catch((err) => { showPromiseError(err); });
    }

    public async ensureCovers() {
      let currR = this.getCoveredRange();
      const targR = this.targetRange;

      // If we already contain it, noop
      if(currR.contains(targR)) { return; }

      await this.longscroll.scheduler.scheduleWrite(this);

      this.debug();

      //TODO: make block-freeing dependent on direction
      //TODO: maybe make a separate paremeter for how much I want buffered?

      // decide when to drop blocks
      // as long as we have blocks
      // and the first block is fully above the leave range
      while(this.blocks.length &&
            this.blocks[0].getRange().bot <= this.leaveRange.top)
            { this.freeBlockAtStart(); }

      // if the last block is fully past the leave range, drop it
      while(this.blocks.length &&
            this.blocks[this.blocks.length-1].getRange().top >= this.leaveRange.bot)
            { this.freeBlockAtEnd(); }



      // Start adding blocks again
      if(! this.blocks.length) { 
        // start first block centered on target row
        const halfBlock = Math.floor(this.preferredBlockSize / 2);
        this.makeFirstBlockAt(this.targetRow - halfBlock); 
      }

      // expand to contain range
      // TODO, move if discontinuous with leaveRange (actually the leaverange freeing might just fix that)
      for(let i = 0; i < 10; i++) {
        currR = this.getCoveredRange();
        console.log(`ensureCovers(${targR}), curr is ${currR}`);

        if(currR.contains(targR)) { return; }

        if(targR.top < currR.top) { this.addBlockAtStart(); }
        if(targR.bot > currR.bot) { this.addBlockAtEnd(); }

        console.log(targR, currR);
      }


    }

    public getBlocks() {
      return this.blocks;
    }

    public toString() {
      let s = "Blockset " + this.getCoveredRange().toString() + " {\n";
      this.blocks.forEach(b => s += "  " + b.toString() + "\n");
      s += "}"
      return s;
    }
    public debug() {
      console.log(this.toString());
      if(!this.leaveRange.contains(this.targetRange))
        { throw Error("Shouldn't be freeing blocks that we need to cover");}

    }

    // returns range or Range(0,0) (if empty)
    public getCoveredRange() {
      if(!this.blocks.length) { return new Range(0,0);}
      else {
        return new Range(
            this.blocks[0].getRange().top,
            this.blocks[this.blocks.length-1].getRange().bot
        );
      }
    }


    public render = _.throttle(() => {
      this.blocks.forEach(b => b.render());
    }, 10)



    public doWork(evt: SchedulerEvent) {
      /* TODO: 
       * This gets called every tick
       * Should first prioritize that all dummy blocks are made on time
       * (this prevents flickering)
       * Should then start filling in blocks when possible
       * Block shouldn't be made if frames are taking too long
       * Block shouldn't be made if last block isn't finished yet
       */
      if((this.longscroll as any).DEBUG) { return;}

      const b = this.getNextUnpreparedBlock();
      if(!b) { return; }

      evt.loadFactor; //number from 0 to 1

      // if we're at 0, we want it to run always
      // if at 1 (taking long time) we want it to not run;
      const shouldRun = Math.random() > evt.loadFactor;

      console.log(`Coin flip: loadFactor frametime:${evt.loadFactor}, result:${shouldRun?"T":"F"}`);

      //if(this.longscroll.timer.getLastFrameDuration() > 30) {
      if (!shouldRun) {
        console.log(`Blockset: skipping doWork, last frame took ${this.longscroll.timer.getLastFrameDuration()}ms`);
        return;
      }
      

      this.doPrepare(b)
          .catch((err) => { showPromiseError(err); });
    }

    // Picks one (or several) blocks which are most important to prepare and
    // prepares them
    // Returns promise which resolves when block is prepared
    private async doPrepare(b: Block) {

      this.longscroll.TICKDEBUG.reset(); // TODO TEMP

      const t1 = Date.now();
      b.prepare();
      const t2 = Date.now();
      const deltaT = t2 - t1;

      const h = b.getRange().height;
      console.log(`Prepared block (${h} rows) in ${deltaT}ms`);

      //dont count old blocks which are just now getting rendered towards block render times
      if(h == this.preferredBlockSize)
        { this.updateBlockTimes(deltaT); }

      return Promise.resolve(null).then(() => this.render())
    }

    // Starts at the center of the viewport and alternates
    // Gets first unprepared Block
    private getNextUnpreparedBlock(): Block|null {
      const targetRow = new Range(0, this.longscroll.data.length).clampNum(this.targetRow);

      let centerBlock = -1;
      for(let i = 0; i < this.blocks.length; i++) {
        if(this.blocks[i].getRange().contains(targetRow)) {
          centerBlock = i;
          break;
        }
      }

      // If the target row doesn't even have dummy blocks on it, maybe chillax
      if(centerBlock == -1) { return null; }

      // want to get blocks before and after the center evenly
      // check both forward and backward
      let back = centerBlock;
      let forward = centerBlock + 1;
      while(back >= 0 || forward < this.blocks.length) {
        if(back >= 0) {
          if(!this.blocks[back].isPrepared()) {
            return this.blocks[back]; } }

        if(forward < this.blocks.length) {
          if(!this.blocks[forward].isPrepared()) {
            return this.blocks[forward]; } }

        back--; forward++;
      }

      return null;
    }


    // ============== Block sizer/scheduler
    // Makes sure that block size is small enough that rendering them doesnt take too long

    private lastTimes: number[] = [];

    // called when we prepare a block
    // If last few blocks have taken too long to render, shrink block size
    private updateBlockTimes(time: number) {

      this.lastTimes.push(time);

      //only keep 5 blocks
      while(this.lastTimes.length > 5) { this.lastTimes.shift(); }

      // If last 5 blocks averaged too long, shrink block size
      if(this.lastTimes.length == 5) {
        // average render time

        // const avg = this.lastTimes.reduce((a,b)=>a+b) / 5;

        // number of frames that went over preferred (
        const numOver = this.lastTimes.filter(t => t > this.longscroll.preferredBlockTime).length;

        // if at least 4 of last 5 frames took too long, shrink block size
        if(numOver >= 4) {

          //Shrink by 20% (min block size based on param
          const shrinkBy = Math.ceil(this.preferredBlockSize * 0.2);
          this.preferredBlockSize = Math.max(this.longscroll.minBlockSize, this.preferredBlockSize - shrinkBy);

          console.log(`SHRUNK BLOCK SIZE TO ${this.preferredBlockSize}`);
          console.log(this.lastTimes);

          //Discard old averages
          this.lastTimes = [];

        }
      }
    }

    // shifts blocks around
    // assume rows have already been updated
    public updateRowSize(rows: Array<{index:number, newSize:number}>) {
      // TODO: maybe do this by deltas later
      this.blocks.forEach(b => {
        b.updatePos(); //recalculates its top position
      });
    }

    // =============== Block adding functions
    //

    private createBlockClamped(r: Range) {
      const clampedRange = r.clampTo(0, this.longscroll.data.length);
      return new LongScroll.BlockImpl(this.longscroll, clampedRange);
    }


    private makeFirstBlockAt(index: number) {
      if(this.blocks.length) { throw Error("MUST ONLY BE CALLED WHEN BLOCKSET EMPTY"); }
      const bRange = new Range(index, index + this.preferredBlockSize);
      const newBlock = this.createBlockClamped(bRange);
      this.blocks[0] = newBlock;

    }

    private addBlockAtStart() {
      const r = this.getCoveredRange();
      const bRange = new Range(r.top - this.preferredBlockSize, r.top);
      const newBlock = this.createBlockClamped(bRange);
      this.blocks.unshift(newBlock);
    }
    private addBlockAtEnd() {
      const r = this.getCoveredRange();
      const bRange = new Range(r.bot, r.bot + this.preferredBlockSize);
      const newBlock = this.createBlockClamped(bRange);
      this.blocks.push(newBlock);
    }


    private freeBlockAtStart() {
      const b = this.blocks.shift();
      b && b.free();
      console.log("freed " + b);
    }

    private freeBlockAtEnd() {
      const b = this.blocks.pop();
      b && b.free();
      console.log("freed " + b);
    }

  }

  // End of BlockSetImpl




  constructor(data: LongScrollDataSource) {
    super();
    this.data = data;

    this.reInit();


    this.debug = this.autoDispose(new LongScroll.DebugCanvas(this)); // TODO JAN TEMP DEBUG
    console.log(this.debug); // TODO: hack, otherwise tslint wont get off my back about unused variables

    this.blocks = new LongScroll.BlockSetImpl(this);
    this.vel = new VelTracker();

    this.scheduler = new Scheduler(this);

    this.timer = this.autoDispose(new AnimationFrameTimer(() => this.tick()));
    this.timer.start();
  }


  public onResize() {
    //TODO: for now just reconstructs it
    this.reInit();
  }

  public onDataChange() {
    this.reInit();
  }

  private reInit() {
    this.rowHeights = new BinaryIndexedTree();
    // for now just init with
    this.rowHeights.fillFromValues(_.times(this.data.length, ()=> 30));

    if(this.dom)
    { dom.styleElem(this.dom.scrollDiv, "height", this.getRowTop(this.data.length) + "px");}
    this._lastPaneHeight = null;

    this.onScroll();
  }

  // ====== Accessors/primitives

  // MEMOIZE VIEWPORT ACCESS
  // prevents forced reflow

  private _lastViewport: Range | null = null;
  // TODO: update on scroll, onresize, etc???
  public get viewport(): Range {
    this.assertInitialized();

    if(this._lastViewport == null) {
      this.recalcViewport();
    }
    return this._lastViewport!;
  }

  private recalcViewport() {
    const t = this.dom!.container.scrollTop;
    this._lastViewport = new Range(t, t + this.dom!.container.clientHeight);
  }

  // returns current height of scroll-div
  // memoize to prevent forced reflow
  // TODO: when to force reset this?
  private _lastPaneHeight: number | null = null;
  public getPaneHeight() {
    if(this._lastPaneHeight == null) {
      this.assertInitialized();
      this._lastPaneHeight =  this.dom!.scrollDiv.clientHeight;
    }

    return this._lastPaneHeight;
  }

  private TICKDEBUG = function(){
      let count = 0;
      console.log(count); //omg shut up tslint
      return {
        reset:     () => {count = 5},
        tick:      () => {count = Math.max(0, count - 1)},
        isStopped: () =>  count === 0,
      }
  }(); // counts down each tick, set to 5 whenever there's work to do

  private tick() {
    this.TICKDEBUG.tick();

    //console.log(`ticking in longscroll`);
    //should prepare one block per frame
    this.scheduler.scheduleIdleWrite(this).then((evt) => this.blocks.doWork(evt));

    this.scheduler.doBatched(); // trigger scheduled dom reads/writes

    if(!this.TICKDEBUG.isStopped())
     { console.log("Frame took " + this.timer.getLastFrameDuration() + "ms in longscroll"); }
  }


  // ======= Dom stuff

  // creates dom, attaches it to elem
  public makeDom(elem:HTMLElement) {
    this.dom = new LongScrollDom(
      elem,
      dom('div#longscroll_outer',
        gr.style("position", "absolute"),
      )
    );

    dom.styleElem(this.dom.scrollDiv, "height", this.getRowTop(this.data.length) + "px");
    dom.styleElem(this.dom.scrollDiv, "width", "100%");

    elem.appendChild(this.dom.scrollDiv);

    this.dom.container.addEventListener('scroll', this.onScroll.bind(this));
  }


  public async updateViewport() {
    if((this as any).DEBUG) { return;}
    this.assertInitialized();
      

    await this.scheduler.scheduleRead(this);

    this.recalcViewport();
    console.log("scrolled: " + this.viewport);
    this.vel.onScroll(this.viewport.top)


    const pixBuff = this.getRegionToBuffer();

    const rowStart = this.getClampedRowAtPx(pixBuff.top);
    const rowEnd =   this.getClampedRowAtPx(pixBuff.bot) + 1;
    const rowsToBuffer = new Range(rowStart, rowEnd);


    // fillInBlocksNeeded

    // If we're scrolling, we want to start preparing blocks ahead of vp center
    // Center of regionToBuffer should work
    const startRenderingFrom = Math.floor((rowStart + rowEnd )/ 2);
    console.log(`Setting target: ${rowStart}, ${rowEnd}`);
    this.blocks.setTarget(rowsToBuffer, startRenderingFrom);

    this.blocks.render();


  }

  // TODO private?
  private onScroll(evt?: Event) {
    if(!this.dom) { console.log("onScroll: longscroll not yet initialized"); return; }

    this.TICKDEBUG.reset() // TODO temp


    this.updateViewport();
  }

  // when a row is measured, we can update its row height here
  // should shift all blocks to account for the change
  // resize scrollpane
  private updateRowSize(rows: Array<{index:number, newSize:number}>) {
    //TODO: dont do anything if old value was the same

    //const changedRows = [];

    this.assertInitialized();
    rows.forEach(r => {
      this.rowHeights.setValue(r.index, r.newSize);
    });


    // reshift blocks (blocks.updateRowSize)
    this.blocks.updateRowSize(rows);


    this.updateViewport();

    const newPaneHeight = this.rowHeights.getTotal();
    this.scheduler.scheduleWrite(this).then(()=> {
      console.log(`resizing scrollPange: ${newPaneHeight} (SKIPPING)`);
      //this.dom!.scrollDiv.style.height = newPaneHeight + "px";
      //this._lastPaneHeight = newPaneHeight; //force recaclc
    })
      .catch((err) => { showPromiseError(err); });

    // update scrollpos (later)
  }

  // ============ Row Height stuff

  // Returns pixel height
  public getRowHeight(index: number): number {
    if(index < 0 || index >= this.data.length) { throw Error("Out of Bounds"); }

    return this.rowHeights.getValue(index);
  }

  public getRowHeightRange(top: number, bottom: number): number;
  public getRowHeightRange(r: Range): number;
  public getRowHeightRange(a: Range|number, b?: number):number {
    let r = Range.unify(a as any, b as any); // handle overload

    return this.rowHeights.getCumulativeValueRange(r.top, r.bot);
  }

  // pixel sum to row
  public getRowTop(index: number) {
    return this.rowHeights.getSumTo(index);
  }

  // get rowIndex at pixel height
  // TODO: add one relative to viewport
  // Errors on out of bounds
  public getRowAtPx(top: number) {
    if(top < 0)
      { throw Error("Pixel pos out of bounds"); }

    const index = this.rowHeights.getIndex(top);

    if(index == this.data.length)
      { throw Error("Pixel pos out of bounds"); }

    return index;
  }

  // get rowIndex at pixel height
  // If before start, returns 0
  // If past end, returns last el (length-1)
  public getClampedRowAtPx(top: number) {
    if(top < 0)
      { return 0; }

    const index = this.rowHeights.getIndex(top);

    if(index >= this.data.length)
      { return this.data.length - 1 }

    return index;
  }

  // End RowHeights


  // returns what region longscroll would like to keep buffered
  //
  private getRegionToBuffer(): Range {
    // playing around with buffering schemes for scroll velocity
    // Idea 1: decide added buffer assymetry, starts at 50/50, asymptote towards 0/100
    // +/- 10 is pretty fast, lets make it about 90% at 10px/ms

    const v = this.vel.getVel();
    const cornerSpeed = 5; // at 10px/ms, shift half of full deflection

    // this is atan, shifted so output is in range 0,1 instead of -pi/2, pi/2
    // and output goes halfway to max at cornerSpeed
    const ratio = Math.atan(v / cornerSpeed) / Math.PI + 0.5;

    const vp = this.viewport;

    // lets buffer increase size as we go faster
    const scaleFactor = Math.max(1, Math.sqrt((Math.abs(v) / 5)));
    const width = 2000 * scaleFactor; // our hypothetical bufferwidth


    const vpCenter = (vp.top + vp.bot) / 2;
    const bottom = vpCenter + width * ratio;
    const top = vpCenter - width * (1 - ratio);


    return new Range(top, bottom);
  }


  private assertInitialized() {
    if(!this.dom){ throw Error("LongScroll dom not initialized"); }
    return true;
  }


  // ==================== DEBUG CANVAS ===============
  // FOR DEBUGGING

  private static DebugCanvas = class DebugCanvasImpl extends Disposable implements DebugCanvas {
    private canvas: HTMLCanvasElement;
    private dom: Element;
    private longscroll: LongScroll;
    private shown: Observable<boolean>;

    private timer: AnimationFrameTimer;

    constructor(longscroll: LongScroll) {
      super();
      this.shown = this.autoDispose(gr.observable(true));

      this.longscroll = longscroll;

      this.dom = debugEl(
          makeToggleButton(this.shown,
            gr.attr("value", "show/hide"),
            gr.style('float','right')),
          this.canvas = debugCanvas(
            gr.cls('.debug-canvas'),
            gr.attrs({width:"200px", height:"800px"}),
            gr.show(this.shown)
          ) as HTMLCanvasElement,
      );
      this.onDispose(()=> { 
        const parent = this.dom.parentNode;
        parent && parent.removeChild(this.dom);
        dom.domDispose(this.dom); 
      });

      document.body.appendChild(this.dom);

      this.timer = this.autoDispose(new AnimationFrameTimer(() => this.draw()));
      this.timer.start();

      this.shown.addListener((val, prev) => {
        if(val == true) { this.timer.start(); }
        else { this.timer.stop(); }

      });
    }

    // called within requestanimationframe
    public draw() {
      try {
      //console.log("Draw debug");
      if(this.shown.get()) { this.doDraw(); }
      } catch(err) {
        //failed to draw
        showPromiseError(err);
      }
    }


    private getScale() {
      return (this.canvas.height * 0.9) / this.longscroll.getPaneHeight();
    }

    // draws a rect, scaled to fit totalHeight
    private rect(ctx:CanvasRenderingContext2D, top:number, bottom:number, width=100, color="black") {
      ctx.save();
      ctx.strokeStyle=color;
      let scale = this.getScale();

      const scaledTop = Math.floor(top * scale);
      const scaledBot = Math.floor(bottom * scale);
      ctx.strokeRect(0, scaledTop, width, scaledBot - scaledTop);
      ctx.restore();
    }


    private labelledRect(ctx:CanvasRenderingContext2D, top:number, bottom:number, width=100, color="black") {
      this.rect(ctx, top, bottom, width, color);
      this.label(ctx, "" + top, top, width,color);
      this.label(ctx, "" + bottom, bottom, width,color);
    }

    // draws a label at y (scaled) offset = x
    private label(ctx:CanvasRenderingContext2D, text:string, y:number, x=100, color="black") {
      const scale = this.getScale();

      ctx.save();
      ctx.fillStyle=color;
      ctx.strokeStyle=color;
      ctx.textBaseline = "middle";

      const width = ctx.measureText(text).width;
      const height = 10; //10px??
      ctx.clearRect(x, Math.floor(y * scale - height/2 - 1), width + 6, height);

      ctx.fillText(text, x+5, Math.floor(y * scale));
      this.drawLine(ctx, x, y*scale, x+4, y*scale);
      ctx.restore();
    }

    private drawLine(ctx:CanvasRenderingContext2D, x1:number, y1:number, x2:number, y2:number) {
      ctx.beginPath();
      ctx.moveTo(Math.floor(x1),Math.floor(y1));
      ctx.lineTo(Math.floor(x2), Math.floor(y2));
      ctx.stroke();
    }


    //draws a label for the given row
    labelRow(ctx:CanvasRenderingContext2D, i:number, x=100, color="black") {
      let top = this.longscroll.getRowTop(i);
      this.label(ctx, "" + i, top, x, color);
    }

    rectRow(ctx:CanvasRenderingContext2D, begin:number, end:number, width=100, color="black") {
      let top = this.longscroll.getRowTop(begin);
      let bottom = this.longscroll.getRowTop(end);
      this.rect(ctx, top, bottom, width, color);
    }

    //label every nth row
    labelRows(ctx:CanvasRenderingContext2D, nth=10) {
      for(let i=nth; i < this.longscroll.data.length; i+=nth) {
        this.labelRow(ctx, i, 10, "lightgray");
      }

      let i = this.longscroll.data.length;
      this.labelRow(ctx, i, 10, "lightgray");
    }

    private doDraw(){
      let ctx = this.canvas.getContext("2d");
      if(!ctx) {return;}
      ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      ctx.save();
      ctx.translate(0.5, 0.5);

      ctx.fillStyle="black";

      this.labelRows(ctx);


      let rBlock = this.longscroll.blocks.getCoveredRange();
      this.rectRow(ctx, rBlock.top, rBlock.bot, 100, "blue");

      const blocks = this.longscroll.blocks.getBlocks();
      blocks.forEach(b => {
        let col = "yellow"
        if(b.isPrepared()){col = "green";}
        const r = b.getRange();
        this.rectRow(ctx!, r.top, r.bot, 90, col);
      });

      /*
      //draw buffered rectangle
      let rb = this.longscroll.begin + this.longscroll.numBuffered/2;
      let re = this.longscroll.end - this.longscroll.numBuffered/2;
      this.rectRow(ctx, rb, re, 100, "green");
      */


      let vp = this.longscroll.viewport;
      this.labelledRect(ctx, vp.top, vp.bot, 100, "red");

      let h = this.longscroll.getPaneHeight();
      this.rect(ctx, 0, h, 150, "black");
      this.label(ctx, "" + h, h, 150);

      ctx.strokeStyle="black";
      let vpCenter = (vp.top + vp.bot) / 2;
      let v = this.longscroll.vel.getVel() * 10;
      this.drawLine(ctx, 50, vpCenter * this.getScale(), 50, vpCenter * this.getScale() + v);
      this.label(ctx, "" + this.longscroll.vel.getVel().toFixed(2), vpCenter, 55);



      const rTarget = this.longscroll.getRegionToBuffer();
      this.rect(ctx, rTarget.top, rTarget.bot, 200, "violet");

      const rLeave = (<any> this.longscroll.blocks).leaveRange as Range;
      if(rLeave)
      { this.rectRow(ctx, rLeave.top, rLeave.bot, 200, "blue"); }

      ctx.restore();
    }



  }


}

interface DebugCanvas {
    draw(): void;
}
