import * as gr from "grainjs";
const dom = gr.dom;

import {LongScroll, LongScrollDataSource} from '../lib/LongScroll';
import * as _ from "underscore";


// sleeps synchronously for n milliseconds
function busyWait(millis: number) {
    // To avoid accidental infinite loop
    if(millis > 1 * 1000) { throw Error("Dont busyWait more than 1s"); }

    const end = Date.now() + millis;
    while(Date.now() < end) {}
}


//returns a 32 bit unsigned integer
//based on bottom 32 bits of a
function intHash(a: number) {
    a = (a+0x7ed55d16) + (a<<12);
    a = (a^0xc761c23c) ^ (a>>>19);
    a = (a+0x165667b1) + (a<<5);
    a = (a+0xd3a2646c) ^ (a<<9);
    a = (a+0xfd7046c5) + (a<<3);
    a = (a^0xb55a4f09) ^ (a>>>16);
    return a >>> 0;
}

// gives a unique height for each row, randomish
// TODO: just for testing
// returns row height in [15, 45)
function hashedRowHeight(index: number) {
    return (intHash(index) % 30) + 15;
}

class TRecord {
    name: gr.Observable<string>;
    randVal: number;


    constructor(name:string){
        this.name = gr.observable(name);
        this.randVal = _.random(0,99);
    }

    makeDom() : Element { 
        const isEdit = gr.observable(false);
        let fieldLabel, fieldEdit: HTMLElement;
        busyWait(1); //slow things down a touch

        return dom("div.record", 
                dom.autoDispose(isEdit),
                dom("div.field", 
                    fieldLabel = dom('span', 
                        dom.domComputed(this.name), 
                        dom.hide(isEdit),
                        dom.on('click', ()=>{
                            isEdit.set(true);
                            fieldEdit.focus();
                        }),
                    ),

                    fieldEdit = gr.dom('input',
                        this.name.get(),
                        (el:Element) => { (el as HTMLElement).focus()},
                        dom.onKeyPress({Enter: ()=>isEdit.set(false)}),
                        //dom.on('blur', ()=>isEdit.set(false)),
                        dom.show(isEdit),
                        //dom.style('border-radius', '0'),
                        //dom.style('border', '0'),
                        //dom.style('line-height', 'inherit'),
                        //dom.style('display', 'block'),
                    ),
                ),
                dom("div.field", this.randVal + ""),
                dom("div.field", "42"),
                dom("div.field", "suffix"),
                dom("div.field", "a"),
                dom("div.field", "b"),
                dom("div.field", "c"),
                dom("div.field", "d"),
                dom("div.field", "e"),
                dom("div.field", "f"),
                dom("div.field", "g"),
                dom("div.field", "h"),
                dom("div.field", "i"),
                dom("div.field", "j"),
                dom("div.field", "k"),
                dom("div.field", "l"),
                dom("div.field", "m"),
                dom("div.field", "n"),
                dom("div.field", "o"),
                dom("div.field", "p"),
                dom("div.field", "q"),
                dom("div.field", "r"),
                dom("div.field", "s"),
                dom("div.field", "t"),
                dom("div.field", "u"),
        )
    };
}

class TRow {
    content: TRecord;
    index: number;

    constructor(content: TRecord, index: number) {
        this.content = content
        this.index = index;
    }

    makeDom() {
        const contentDom = this.content.makeDom();
        dom.styleElem(contentDom, "min-height", hashedRowHeight(this.index) + "px");

        return dom("div.row",
            dom("div.field.row_num", this.index + ""),
            contentDom
        );
    }

    //Makes dummy dom of a given height
    makeDummyDom() {
        return dom("div.row",
            dom("div.field.row_num", this.index + ""),
            dom("div.field"),
        );
    }
}

// an array of rowmodels
class TTable {
    rows: TRow[];

    constructor(records: TRecord[]){
        this.rows = [];
        records.forEach((r, i) => {
            const row = new TRow(r, i);
            this.rows.push(row);
        })
    }
}



class TDataSource implements LongScrollDataSource {
    table: TTable;
    constructor(table: TTable) {
        this.table = table;
    }

    get length() { return this.table.rows.length; }
    getRow(i:number) { return this.table.rows[i]; }

    makeDom(model: TRow): Element;
    makeDom(index: number): Element;
    makeDom(a: TRow|number) : Element{ 
        if(typeof a == "number") 
            { return this.getRow(a).makeDom(); }
        else 
            { return a.makeDom(); }
    }

    //Makes dummy dom.
    //Will be styled to fixed-height by longscroll
    makeDummyDom(index: number) {
        return this.getRow(index).makeDummyDom();
    }

    freeDom(index: number, elm: Element) { }
    freeDummyDom(index: number, elm: Element) { }
}





// returns an array of n random-ish strings
function makeTestStrings(n: number): string[] {
    const take = (arr: any[]) => arr[_.random(0, arr.length - 1)];
    const starts = "bor tak kni lop foo zan muck rop sup taf".split(' ');
    const ends = "bo lan zanth tiff roe see ack mole bup bop baz".split(' ');

    const accum = [];
    for(let i = 0; i < n; i ++) {
        accum.push(take(starts) + take(ends));
    }
    return accum;
}



const testRecords = makeTestStrings(800).map(str => new TRecord(str));

const testTable = new TTable(testRecords);
const testDataSrc = new TDataSource(testTable);
const s = new LongScroll(testDataSrc);
(<any>window).s = s;

let scrollBox: HTMLElement;
const container = 
        dom('div.container', 
            'Testing LongScroll',
            scrollBox = dom('div.scrollbox'))

s.makeDom(scrollBox);


document.body.appendChild(container);

s.onResize();


function doSlowScroll() {
    let s = scrollBox;
    s.scrollTop = 0;

    let timer: any;
    let iters = 0;
    

    function tick() {
        s.scrollTop += 300;
        iters += 1;
        if(iters > 1000) {
            clearInterval(timer);
        }
    }


    (window as any).stopScroll = (() => clearInterval(timer));
    timer = setInterval(tick, 10);
}
(window as any).scroll = doSlowScroll;




