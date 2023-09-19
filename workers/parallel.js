/**
 * This is for subdividing use only, so we make very simplify interface.
 * pattern after intel TBB's parallel_for(),
 * but webworker is very different, webworker cannot shared functions and data easily,
 * so the calling interface well be very different. we have to passed in data/func
 * in group. setup/tearDown to shared var.
 *  
 */
 
 
class WebWorkerPool {
   constructor(sourceScript, maxWorkers) {
      this._tasks = new Map;         // key=[worker], value=[taskGroup, promise?].
      this._tasksQueue = [];         // Promise that is waiting to resolved.
      this._pool = [];               // worker thread pool all, (free/non-free)
      this._freePool = [];           // freed worker pool 
      
      // precreate webWorker for working purpose
      for (let i = 0; i < maxWorkers; ++i) {
         const worker = new Worker(sourceScript, {type: "module"});
         worker._task = 0;
         worker.onmessage = (e)=>{  // only "completed" work, message will be sented back.
            this.freeWorker(worker);
         }
         this._pool.push(worker);
         this._freePool.push(worker);
      }
   }
   
   freeWorker(worker) {
      // remove froms tasks
      const taskGroup = this._tasks.get(worker);
      taskGroup._taskDone();
      if (--worker._task === 0) { 
         // get queuing jobs and exec if any.
         if (this._tasksQueue.length) {
            const task = this._tasksQueue.pop();
            task(worker);
         } else { // no jobs, putback to freePool;
            this._freePool.unshift(worker);
            this._tasks.delete(worker);
         }
      }
   }
   
   
   //
   // queue postmessage even when busy.
   // used by setup() and tearDown()
   //
   execAll(taskGroup, msg) {
      for (let worker of this._pool) {
         taskGroup._addTask();
         worker.postMessage(msg);
         this._tasks.set(worker, taskGroup);
         ++worker._task;
      }
   }

   // 
   // exec one function 
   //
   exec(taskGroup, msg) {
      taskGroup._addTask();
      if (this._freePool.length) {
         const worker = this._freePool.pop();
         worker.postMessage(msg);
         this._tasks.set(worker, taskGroup);
         ++worker._task;
      } else { // queue the task to be called by freed worker.
         this._tasksQueue.unshift( (worker)=>{
            worker.postMessage(msg);
            this._tasks.set(worker, taskGroup);
            ++worker._task;
         });
      }
   }
}



class TaskParallel {
   constructor(pool) {           // passed the worker bool
      this._pool = pool;
      this._totalTasks = 0;      // the number of tasks waiting to finished
      this._wait = null;
   }
   
   _addTask() {
      ++this._totalTasks;
   }
   
   _taskDone() {
      --this._totalTasks;
      if (this._totalTasks === 0) {
         if (this._wait) {       
            if (this._wait.inProgress) {     // wait until all tearDown is done
               this._wait.resolve(this._wait.ret);
               this._wait = this._ret = null;
            } else { // start the tearDown process
               this.tearDown("tearDown");
               this._wait.inProgress = true;
            }
         }
      }
   }
   
   tearDown(tearDownFn) {  // every worker
      this._pool.execAll(this, {action: tearDownFn});
   }
   
   setup(data, setupFn) {
      const msg = Object.assign({action:setupFn}, data);
      this._pool.execAll(this, msg);
   }
   
   exec(data, fnName) {
      const msg = Object.assign({action: fnName}, data);
      this._pool.exec(this, msg);
   }
   
   pFor(start, end, blockSize, fnName) {
      
      // compute count(end-start), partition task units
      let blockStart = Math.floor(start / blockSize);
      let blockEnd = Math.ceil(end / blockSize);

      const hardEnd = end;
      // dispatch to multiple webworkers
      for (let i = blockStart; i < blockEnd; ++i) {
         end = start + blockSize;
         if (end > hardEnd) {
            end = hardEnd;
         }
         // dispatch blockSize of works.
         this._pool.exec(this, {start, end, action:fnName});
         start = start + blockSize;
      }
   }
   
   /**
    * return a promise that wait for all running tasks of this taskGroup to end
    * 
    */
   whenDone(ret) {
      return new Promise((resolve, reject)=>{
         if (this._totalTasks === 0) {
            this.tearDown("tearDown");
            resolve(ret);
         } else {
            this._wait = {resolve, reject, ret, inProgress: false};
         }
      });
   }
}

export {
   WebWorkerPool,
   TaskParallel,
}
