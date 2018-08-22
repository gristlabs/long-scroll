
// Used to queue up work to be done for later
// Queue DOM reads/writes to be scheduled for the same time
// Queue idle work to be done when free?
//  (also maybe dom mutations have a priority like that)
//
// Keeps track of time taken maybe?
// Maybe have provision for resumable tasks (using asyncawait)
//
//


import {LongScroll} from './LongScroll';

export interface SchedulerEvent {
  lastFrameTime: number;
  loadFactor: number; // 0 to 1, 0 is idle, 1 is overloaded
}

export class TaskCancelledError extends Error {
}

enum TaskState {
  Pending, Fulfilled, Rejected
}

/* TODO: dunno if this is useful really
// Promise that can be triggered or cancelled manually
class TriggerablePromise<T> extends Promise<T> {
  constructor() {
    let resolver, rejecter;
    super((resolve, reject) => {
      resolver = resolve;
      rejecter = reject;
    })

    if(!resolver || !rejecter) { throw Error("Promise creation failed"); }
    this.trigger = resolver;
    this.cancel  = rejecter;
  }

  public trigger: (val: T)=> void; //resolves this function with value T
  public cancel: (val: Error)=> void; //rejects function with error
}
*/


class Task {
  public state: TaskState;
  public promise: Promise<SchedulerEvent>;
  public readonly owner: Object;

  private resolveP: (val: SchedulerEvent)=> void; //resolves this function with value T
  private rejectP: (val: Error)=> void; //rejects function with error

  constructor(owner: Object) {
    this.owner = owner;
    this.state = TaskState.Pending;

    // Make a promise, and save methods to trigger it
    this.promise = new Promise((resolve, reject) => {
      this.resolveP = resolve;
      this.rejectP = reject;
    })

    if(!this.rejectP || !this.resolveP) { throw Error("Promise creation failed"); }
  }


  public run(evt: SchedulerEvent) { //resolves this function with value T
    if(this.state != TaskState.Pending) { throw Error("Task already resolved/rejected"); }
    this.state = TaskState.Fulfilled;
    this.resolveP(evt);
  }

  public cancel(err: Error) {  //rejects function with error
    if(this.state != TaskState.Pending) { throw Error("Task already resolved/rejected"); }
    this.state = TaskState.Rejected;
    this.rejectP(err);
  }

  public toString() {
    return `Task(owner:${this.owner}, state: ${TaskState[this.state]})`;
  }
}

class SchedulerQueue {
  private queue: Task[] = [];

  addTask(t:Task) {this.queue.push(t);}

  // Executes all tasks in queue, 
  // NOTE: if task queues another task into the same queue,
  // It can call it within the same executeTasks.
  // That's probably a good thing
  async executeTasks(evt: SchedulerEvent) {
    for(let i = 0; i < this.queue.length; i++) { 
      const task = this.queue[i]; 
      if(task.state === TaskState.Rejected) { continue; } //skip cancelled tasks
      if(task.state === TaskState.Fulfilled) { throw Error("Promise already fulfilled in SchedulerQueue: BUG"); }
      task.run(evt); //fire off the task
    }

    this.queue = [];
    
    //queue up a new promise, this should go on the back of the event queue
    await Promise.resolve();
  }

  clearTasksBy(ownerObj: Object) {
    for(let i = 0; i < this.queue.length; i++) {
      const task = this.queue[i];
      if(task.owner === ownerObj && task.state === TaskState.Pending) { 
        console.log("Cancelling task: " + this.queue[i]);
        this.queue[i].cancel(new TaskCancelledError("Task Cancelled"));
      }
    }
  }
}

export class Scheduler {
  //Needs some way to cancel
  private readQueue: SchedulerQueue;
  private writeQueue: SchedulerQueue;
  private idleWriteQueue: SchedulerQueue;

  private lowThresh = 25; // Below this is idle
  private hiThresh = 50; // Above this is max load (TODO, maybe make exponential backoff instead)
  private maxLoad = 0.95; //never go above 0.95, so at least some work gets done (TODO, maybe this wont be needed)

  private DEBUGMAXLOAD = false; // TODO: what for debuggin and suchlike

  //TODO, ultimately scheduler should do all the timing stuff itself so it doesnt need a ref to longscroll
  constructor(private longscroll: LongScroll) {
    this.readQueue = new SchedulerQueue();
    this.writeQueue = new SchedulerQueue();
    this.idleWriteQueue = new SchedulerQueue();
  }

  // Read and write will be fulfilled when the proper phase of an animationframe comes around
  private makeTaskForQueue(owner: Object, targetQueue: SchedulerQueue) {
    let t = new Task(owner);
    targetQueue.addTask(t);
    return t.promise;
  }

  public scheduleRead(owner: Object): Promise<SchedulerEvent>  
    { return this.makeTaskForQueue(owner, this.readQueue); }

  public scheduleWrite(owner: Object): Promise<SchedulerEvent>
    { return this.makeTaskForQueue(owner, this.writeQueue); }

  public scheduleIdleWrite(owner: Object): Promise<SchedulerEvent>
    { return this.makeTaskForQueue(owner, this.idleWriteQueue); }


  private getLoadFactor(): number {
      if(this.DEBUGMAXLOAD) { return 1; }

      // This is idle work, we want to throttle it back when frame times get too long
      const frameTime = this.longscroll.timer.getAveragedFrameTime();

      // we want to throttle smoothly between low threshold and high threshold
      // TODO: hard limits like this might be pathological on slow machines. Maybe add some sort of timeout mechanism

      
      // 0 at low thresh, 1 at high, clamped
      const loadFactor = (frameTime - this.lowThresh) / (this.hiThresh - this.lowThresh);
      const loadFactorClamped = Math.max(0, Math.min(this.maxLoad, loadFactor));

      // if we're at 0, we want it to run always
      // if at 1 (taking long time) we want it to run anyway
      //console.log(`Load Factor: avg frametime:${frameTime}, scaled:${loadFactorClamped}`);
      return loadFactorClamped
  }

  public async doBatched() {
    // Null the promise first, so new reads are queued for the next frame
    // Maybe that's not needed tho actually. Like we can keep adding reads as much as we want
    // once we're already reading
    // hmm
    
    const schedEvent = { 
      lastFrameTime: this.longscroll.timer.getLastFrameDuration(),
      loadFactor: this.getLoadFactor()
    }

    console.timeStamp("Doing batched tasks");
    await this.readQueue.executeTasks(schedEvent);
    await this.writeQueue.executeTasks(schedEvent);
    //TODO: make this throttled better somehow?
    await this.idleWriteQueue.executeTasks(schedEvent);
    console.timeStamp("end batched");
  }

  //cancel jobs where owner matches this
  public cancelJobs(owner: Object) {
    console.log("cancelling jobs for: " + owner);
    this.readQueue.clearTasksBy(owner);
    this.writeQueue.clearTasksBy(owner);
    this.idleWriteQueue.clearTasksBy(owner);
  }
}
