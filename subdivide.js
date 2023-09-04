/**
 * DirectedEdge, Catmull-Clark subdivision, Loop Sudivision, Modified Buttefly Subdivision.
 * 
 */
 
import {QuadMesh} from './quadmesh.js';
 import {TriangleMesh} from './trimesh.js';
 import * as Tri from './subdividetri.js';
 import * as Loop from './subdivideloop.js';
 // import * as MB from './subidivdemb.js';
import * as Parallel from './workers/subdivideparallel.js';


async function loopSubdivide(subd, source) {
   // setup the source
   const task = Tri.computeWorkTask(source);
   const mDat = Tri.setupSubdivide(subd, source, task, Loop.edgeNewVertex, Loop.vertexRefine);

   // copy/refine vertex and add middle edge points.
   for (let i = 0; i < task.vMix.length; ++i) {
      Tri.vertexTask(mDat, i);
   }
   //refineEdge(subd, source, computeSubdivideMid);
   Tri.vertexTaskRemainder(mDat);
   
   // setup all face's hEdge
   let length = source.f.length();
   for (let i = 0; i < length; ++i) {
      Tri.triTask(mDat, i);
   }
   
   // setup wEdge's halfEdge
   for (let i = 0; i < task.wMix.length; ++i) {
      Tri.wEdgeTask(mDat, i);
   }
   Tri.wEdgeTaskRemainder(mDat);
   
   // setup hole
   
   return subd;  
}




function createNextLevelTriMesh(source) {
   const subd = TriangleMesh.create(source._material.depot);
   subd.v._valenceMax = source.v.valenceMax();
   
   // preallocated enough points to next subdivision level, 
   subd.v._allocEx(source.v.length() + source.h.lengthW());
   // preallocated next level of the wEdges/Faces.
   subd.h._allocEx(source.f.length() * 4 * 3);           // directedEdge mapped to face 3:1
   subd.h._allocWEdge(source.h.lengthW()*2 + source.f.length()*3);
   subd.f._allocEx(source.f.length() * 4);

   return subd;
}



async function triSubdivide(subdivideFn, source, level) {
   let subd = source;

   let text = "";
   let multi = 1;
   for (let i = 0; i < level; ++i) {
      let start = Date.now();

      subd = await subdivideFn(createNextLevelTriMesh(subd), subd);
      // TODO: readjust _material
      //multi *= 4;
      //
      text += "(level: " + (i+1) + ", time: " + (Date.now()-start) + ")\n";
      if (1) {
         const sanity = subd.sanityCheck();
         console.log("mesh integrity: " + sanity);
         console.log(subd.stat());
      }
   }
   // readjust _material
   for (let [mat, count] of source.m) {
      subd.m.addRef(mat, count*multi);
   }
   return [subd, text];
}

async function subdivideCC(source, level) {
   
}

async function subdivideMB(source, level) {
   return triSubdivide(mbSubdivide, source, level);
}

async function subdivideLoop(source, level) {
   if (true) {
      return triSubdivide(loopSubdivide, source, level);
   } else {
      return triSubdivide(Parallel.loopSubdivide, source, level);
   }
}

export {
   subdivideCC,
   subdivideMB,
   subdivideLoop,
}
