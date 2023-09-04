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
      for (let i = msg.start; i < msg.end; ++i) {
         Tri.vertexTask(_mData, i);
      }
   },
   
   vertexTaskRemainder: function(_msg) {
      Tri.vertexTaskRemainder(_mData);
   },
   
   holeTask: function(msg) {
      
   },
   
   faceTask: function(msg) {
      for (let i = msg.start; i < msg.end; ++i) {
         Tri.triTask(_mData, i);
      }
   },
   
   wEdgeTask: function(msg) {
      for (let i = msg.start; i < msg.end; ++i) {
         Tri.wEdgeTask(_mData, i);
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
