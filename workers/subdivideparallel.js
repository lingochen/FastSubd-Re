/**
 * DirectedEdge, Catmull-Clark subdivision, Loop Sudivision, Modified Buttefly Subdivision.
 * 
 */
 
import {QuadMesh} from '../quadmesh.js';
import {TriangleMesh} from '../trimesh.js';
import * as Tri from '../subdividetri.js';
import * as Loop from '../subdivideloop.js';
// import * as MB from '../subidivdemb.js';
import * as Parallel from './parallel.js';
import * as test from './subdivideworker.js';

let gTasker;
function getTasker() {
   if (!gTasker) {   // init gTasker
      const pool = new Parallel.WebWorkerPool('./workers/subdivideworker.js', 4);
      gTasker = new Parallel.TaskParallel(pool);
   }
   return gTasker;
}


function loopSubdivide(subd, source) {
   const tasker = getTasker();
   // Setup TaskGroup
   const task = Tri.computeWorkTask(source);
   const dest = subd.getDehydrate({});
   const src = source.getDehydrate({});
   tasker.setup({subd: dest, source: src, task}, 'loop');
   
   // compute blockSize, 
   
   const blockSize = 4;
   // copy/refine vertex and add middle edge points.
   tasker.pFor(0, task.vMix.length, blockSize*3, 'vertexTask');
   // copy/refine the remainder
   tasker.exec(null, 'vertexTaskRemainder');
   
   // setup all face's hEdge
   tasker.pFor(0, source.f.length(), blockSize*3, 'faceTask');
   
   // setup wEdge's halfEdge
   tasker.pFor(0, task.wMix.length, blockSize*10, 'wEdgeTask');
   tasker.exec(null, 'wEdgeTaskRemainder');
   //throw("error");
   
   // setup hole
   tasker.exec(null, 'boundaryLoopTask');
   
   // return when everything done.
   return tasker.whenDone(subd);       // return an promise
}



export {
   
   //mbSubdivide,
   loopSubdivide,
}
