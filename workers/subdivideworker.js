/**
 * webWorker based subdivider 
 * 
 * 
 */
import {TriangleMesh} from '../trimesh.js';
import * as Tri from '../subdividetri.js';
import * as Loop from '../subdivideloop.js';
//import {TaskGroup, WebWorker} from './workers/parallel'; 
 
 

let _mData = {};
let _mIndex = [];
function* nextTask(indexBuffer, hardEnd, blockSize) {
   const index = _mIndex[indexBuffer];
   let current;
   do {
      const start = Atomics.add(index, 0, blockSize);
      current = start;
      let end = Math.min(start+blockSize, hardEnd);
      /*while (current < end) {
         yield current;
         current++
      }*/
      yield [current, end];
   } while (current < hardEnd);
}


 
function loopSubdivide(subd, source) {
   // Setup TaskGroup
   const task = Tri.computeWorkTask(source);
   _mData = Tri.setupSubdivide(subd, source, task, Loop.edgeNewVertex, Loop.vertexRefine);
}


//
// message passing to webWorker
//
const loopState = {
   vertexTask: function(msg) {
      for (let [start, end] of nextTask(msg.index, msg.end, msg.blockSize)) {
         for (let i = start; i < end; ++i) {
            Tri.vertexTask(_mData, i);
         }
      }
   },
   
   vertexTaskRemainder: function(_msg) {
      Tri.vertexTaskRemainder(_mData);
   },
   
   boundaryLoopTask: function(msg) {
      Tri.boundaryLoopTask(_mData);
   },
   
   faceTask: function(msg) {
      for (let [start, end] of nextTask(msg.index, msg.end, msg.blockSize)) {
         for (let i = start; i < end; ++i) {
            Tri.triTask(_mData, i);
         }
      }
   },
   
   faceTaskV: function(msg) {
      for (let [start, end] of nextTask(msg.index, msg.end, msg.blockSize)) {
         for (let i = start; i < end; ++i) {
            Tri.triTaskV(_mData, i);
         }
      }
   },
   
   faceTaskP: function(msg) {
      for (let [start, end] of nextTask(msg.index, msg.end, msg.blockSize)) {
         for (let i = start; i < end; ++i) {
            Tri.triTaskP(_mData, i);
         }
      }
   },   
   
   faceTaskW: function(msg) {
      for (let [start, end] of nextTask(msg.index, msg.end, msg.blockSize)) {
         for (let i = start; i < end; ++i) {
            Tri.triTaskW(_mData, i);
         }
      }
   },
   
   wEdgeTask: function(msg) {
      for (let [start, end] of nextTask(msg.index, msg.end, msg.blockSize)) {
         for (let i = start; i < end; ++i) {
            Tri.wEdgeTask(_mData, i);
         }
      }
   },
   
   wEdgeTaskRemainder: function(_msg) {
      Tri.wEdgeTaskRemainder(_mData);
   },
   
   tearDown() {
      _mData = {};
      gHandler = initState;
   },
}


const initState = {
   loop: function(data) {
      // rehydrate
      const source = TriangleMesh.rehydrate(data.source);
      const dest = TriangleMesh.rehydrate(data.subd);
      loopSubdivide(dest, source);
      // switch gHandler to LoopState
      gHandler = loopState; 
   },
   
   mb: function(data) {
      
   }, 
   
   tearDown: function() {
      _mData = {};
      // switch back to initState
      gHandler = initState;
   },
}

let gHandler = initState;


 
// the main function passing
onmessage = (e)=> {
   for (let i = 0; i < 6; ++i) {
      _mIndex.push( new Int32Array(e.data, i*64, 16)  ); // thread startup needs to get the sharedIndexBuffer
   }
   // change to normal message handling.
   onmessage = (e)=> {
      const fn = gHandler[e.data.action];
      if (fn) {
         const ret = fn(e.data);
         // let caller knows we are done.
         postMessage(e.data.action);
      } else {
         console.log("failure: no " + e.data.action);
         postMessage('unknown method');
      }
   }
}
