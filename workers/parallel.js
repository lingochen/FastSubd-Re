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
      this._tasksQueue = [];         // Promise that is waiting to resolved.
      this._pool = [];               // worker thread pool all, (free/non-free)
      this._freePool = [];           // freed worker pool 
      const forBuffer = new SharedArrayBuffer(64*3);     // forLoop webworker indexing purpose
      this._for = {current: 0, index: []};
      this._for.index.push( new Int32Array(forBuffer, 0, 16) );
      this._for.index.push( new Int32Array(forBuffer, 64, 16) );
      this._for.index.push( new Int32Array(forBuffer, 128, 16) );
      
      // precreate webWorker for working purpose
      for (let i = 0; i < maxWorkers; ++i) {
         const worker = new Worker(sourceScript, {type: "module"});
         // initialized indexBuffer
         worker.postMessage(forBuffer);
         // saved on list.
         worker._task = 0;
         worker.onmessage = (e)=>{  // only "completed" work, message will be sented back.
            this.freeWorker(worker);
         }
         this._pool.push(worker);
         this._freePool.push(worker);

      }
      
      // precreated index buffer for iteration purpose.
      
   }
   
   freeWorker(worker) {
      // remove froms tasks
      const taskGroup = worker._taskGroup;
      //taskGroup._taskDone();
      if (--worker._task === 0) { 
         // get queuing jobs and exec if any.
         while (this._tasksQueue.length) {
            const task = this._tasksQueue.pop();
            task(worker);
            if (worker._task > 0) {
               break;
            }
         } 
         if (worker._task === 0) { // no jobs, putback to freePool;
            this._freePool.unshift(worker);
            worker._taskGroup = null;
         }
      }
      // only decrement when everything is settled 
      taskGroup._taskDone();
   }
   
   
   //
   // queue postmessage even when busy.
   // used by setup() and tearDown()
   //
   execAll(taskGroup, msg) {
      for (let worker of this._pool) {
         taskGroup._addTask();
         worker.postMessage(msg);
         worker._taskGroup = taskGroup;
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
         worker._taskGroup = taskGroup;
         ++worker._task;
      } else { // queue the task to be called by freed worker.
         this._tasksQueue.unshift( (worker)=>{
            worker._taskGroup = taskGroup;
            ++worker._task;
            worker.postMessage(msg);
         });
      }
   }
   
   // 
   execFor(taskGroup, start, end, blockSize, fnName) {
      // get for Index and build msg
      const curIndex = this._for.current;
      this._for.current = (this._for.current + 1) % 3;   // advance to next available index ?
      this._for.index[curIndex][0] = start;              // NOTE:　do we needs to check for availability
      const msg = {index: curIndex, end, blockSize, action: fnName};
      
      // grab as much worker as possible. NOTE, but less then end
      while (this._freePool.length) {
         const worker = this._freePool.pop();
         taskGroup._addTask();
         worker._taskGroup = taskGroup;
         ++worker._task;
         worker.postMessage(msg);
      }
      // add to taskQueue to grab new worker if needed and available.
      const forTask = (worker)=>{
         // checked if works still available
         const current = Atomics.load(this._for.index[curIndex], 0);
         if (current < end) {
            taskGroup._addTask();
            worker._taskGroup = taskGroup;
            ++worker._task;
            worker.postMessage(msg);
            // push() instead of unshift() because forLoop running together should be more efficient
            this._tasksQueue.push(forTask);
         }
      }
      this._tasksQueue.unshift(forTask);
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
            if (this._wait.inTearDown) {     // wait until all tearDown is done
               this._wait.resolve(this._wait.ret);
               this._wait = this._ret = null;
            } else { // start the tearDown process
               this.tearDown("tearDown");
               this._wait.inTearDown = true;
            }
         }
      }
   }
   
   tearDown(tearDownFn) {  // every worker
      this._pool.execAll(this, {action: tearDownFn});
   }
   
   setup(data, setupFnName) {
      const msg = Object.assign({action:setupFnName}, data);
      this._pool.execAll(this, msg);
   }
   
   exec(data, fnName) {
      const msg = Object.assign({action: fnName}, data);
      this._pool.exec(this, msg);
   }
   
   pFor(start, end, blockSize, fnName) {
      this._pool.execFor(this, start, end, blockSize, fnName);
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
            this._wait = {resolve, reject, ret, inTearDown: false};
         }
      });
   }
}

export {
   WebWorkerPool,
   TaskParallel,
}
