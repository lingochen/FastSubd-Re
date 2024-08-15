/**
 * pairing triangle to form quad, the criteria are
 *  0) as many quad as possible.
 *  1) pair triangles to be as rectangle as possible.
 *  2) nearly same normal?
 *  3) 2 dangling triangle with quad can be transform to 2 quad.
 *  4) how about flipping triangle edge to form more quad?
 * 
 * this is for mesh color patch, so 2) is not as important?
 * 
 */
 
import {SurfaceMesh} from './surfacemesh.js';
import {vec3, vec3a} from './vec3.js'; 
 


function computeAngleAndNormal(vec, position, a, b, c) {
   vec3.sub(vec.ba, 0, position, a, position, b);
   vec3.sub(vec.bc, 0, position, c, position, b);
   
   const normal = [0, 0, 0];
   vec3.cross(normal, 0, vec.ba, 0, vec.bc, 0);
   const length = vec3a.length(normal, 0);
   
   const angleB = Math.atan2(length, vec3a.dot(vec.bc, 0, vec.ba, 0));
   
   vec3.sub(vec.ca, 0, position, a, position, c);
   vec3.negate(vec.cb, 0, vec.bc, 0);
   
   const angleC = Math.atan2(length, vec3a.dot(vec.cb, 0, vec.ca, 0));
   
   const angleA = Math.PI - angleB - angleC;           // triangle internal angle add up to 180 degree.
   
   return [normal, length/2, angleA, angleB, angleC];
}


const NinetyDeg = Math.PI / 2;
/**
 * step to pairing quad
 * 1) compute face normal vector.
 * 2) compute each hEdge angle.
 * 3) compute each wEdge value by using hEdge angles + normal vectors .
 * 2) every triangles determined it best pair if any. if isolated triangles then removed from list
 * 3) if best pair agreed then the quad is done. the best pair can be removed.
 * 4) loop back to (2) if there is still triangles available. 
 * 
 * @return 
 */
function quadrangulate(mesh, angleTolerance=(Math.PI/12)) {
   // compute all hEdge Angle and face normal
   const position = mesh.v.positionBuffer();
   const hEdgeAngle = [];
   const triNormal = [];
   const triArea = [];
   const workVec = {ba: [0,0,0], bc: [0,0,0], ca: [0,0,0], cb: [0,0,0] }; 
   for (let tri of mesh.f) {     // compute left, and right vector
      const hEdge = tri * 3;
      const a = mesh.h.origin(hEdge);
      const b = mesh.h.origin(hEdge+1);
      const c = mesh.h.origin(hEdge+2);
      const [normal, area, angleA, angleB, angleC] = computeAngleAndNormal(workVec, position, a*4, b*4, c*4);
      hEdgeAngle.push( angleA, angleB, angleC );
      triNormal.push( normal );
      triArea.push( area );
   }

   // compute wEdge deviation from 90 degree angle and check the adjacent Face is within tolerance.
   const wEdgeBIAS = [];
   for (let [_wEdge, leftH, rightH] of mesh.h) {
      // check both side of face, and see if they are within tolerance
      let bias = Math.PI*3;               // worst case, boundary 
      const leftF = mesh.h.face(leftH);
      const rightF = mesh.h.face(rightH);
      if (leftF >= 0 && rightF >= 0) {
         const leftN = triNormal[ leftF ];
         const rightN = triNormal[ rightF ];
         bias = Math.abs( vec3a.angle(leftN, 0, rightN, 0) );
         if (bias > angleTolerance) {
            bias = Math.PI;            // make the wEdge less desirable
         } else {
            bias = 0;
         }
      
         // get angle, add up, and compare to 90 degree
         const leftNext = mesh.h.next(leftH);
         const rightNext = mesh.h.next(rightH);
         const origin = hEdgeAngle[leftH] + hEdgeAngle[rightNext];
         const dest = hEdgeAngle[rightH] + hEdgeAngle[leftNext];
         bias += Math.abs(origin - NinetyDeg) + Math.abs(dest - NinetyDeg);
      }
      wEdgeBIAS.push(bias);
   }
   
   // allocated triangles pair array
   let triangle = {available: mesh.f.length(),              // how many triangle that not paired/isolated.
                   paired: new Array(mesh.f.length()),      // finalized pair,
                   bestFit: new Array(mesh.f.length()),     // current bestFit scratch array.
                  };
                  
   // pairing until no triangle left
   while (triangle.available) {
      // tried to find the best fit
      for (let tri of mesh.f) {
         if (!triangle.paired[tri]) {  // is available? tried to find pair
            let bestFit = [tri, Math.PI*2];  // self, at worst an isolated triangle
            // try to find best available pair of triangle.
            for (let hEdge of mesh.halfEdgeAroundFace(tri)) {
               const pair = mesh.h.pair(hEdge);
               if (pair >= 0) {        // not boundary loop, so valid face
                  const candidateFace = mesh.h.face(pair);
                  if (!triangle.paired[candidateFace]) {    // is face not paired yet
                     const wEdge = mesh.h.wEdge(hEdge);
                     const bias = wEdgeBIAS[wEdge];
                     if (bias < bestFit[1]) {            // check if better fit?
                        bestFit[0] =  candidateFace;
                        bestFit[1] = bias;
                     }
                  }
               }
            }
            // recorded the current bestFit
            triangle.bestFit[tri] = bestFit[0];
         }
      }
      
      // tried to paired the best quad
      const count = triangle.available;
      for (let tri of mesh.f) {  //https://www.tomshardware.com/
         if (!triangle.paired[tri]) {                    // not paired yet
            const best = triangle.bestFit[tri];
            if (tri === best) {                          // isolated?
               triangle.paired[tri] = 1;
               triangle.bestFit[tri] = tri;
               triangle.available--;
            }else if (tri === triangle.bestFit[best]) {  // both triangle agreed they are best quad
               triangle.paired[tri] = 1; 
               triangle.paired[best] = 1;
               triangle.bestFit[tri] = best;
               triangle.bestFit[best] = tri;
               triangle.available -= 2;
            }
         }
      }
      
      // check if we are making progress, if not, the non-paired will mark as pair, first come first serve. TODO: better metric?
      if (count === triangle.available) {
         for (let tri of mesh.f) {
            if (!triangle.paired[tri]) {
               const best = triangle.bestFit[tri];
               if (!triangle.paired[best]) {    // available?
                  triangle.paired[best] = 1;
                  triangle.bestFit[tri] = best;
                  triangle.bestFit[best] = tri;
               } else { // TODO: find next best fit, instead of isolated it.
                  triangle.bestFit[tri] = tri;
               }
               triangle.paired[tri] = 1;       // removed from paired list.
            }
         }
         triangle.available = 0;
      } 
   }
   
   // Another pass to find 2 dangling triangles that are separate by quad, break-up the quad and create 2 quad with the dangling triangles.
   // Note: how about angleTolerance?
   const isolated = new Map;
   for (let tri of mesh.f) {
      if (triangle.bestFit[tri] === tri) {   // isolated triangle, now find neighboring quad
         for (let face of mesh.faceAroundFace(tri)) {
            const quadFace = triangle.bestFit[face];
            // check if another dangling triangle
            const dangling = isolated.get(face);
            if (dangling) {   // got it now create 2 quad from (tri, face), (quadFace, dangling)
               if (triangle.bestFit[dangling] === dangling) {
                  triangle.bestFit[tri] = face;
                  triangle.bestFit[face] = tri;
                  triangle.bestFit[quadFace] = dangling;
                  triangle.bestFit[dangling] = quadFace;
                  triangle.paired[tri] = 1;
                  triangle.paired[dangling] = 1;
                  break;
               } else { // oops, already paired, delete it
                  isolated.delete(face);
               }
            } else { // put the quadFace for later matching.
               isolated.set(quadFace, tri);
            }
         }
      }
   }
     
   
   // now create the quad, and the isolated tri list
   const quad = [];
   const tri = [];
   for (let face of mesh.f) {
      const best = triangle.bestFit[face];
      if (best === face) {
         tri.push( face );
      } else if (best > face) {
         quad.push(face, best);
      }
   }
   
   return [quad, tri, triArea];
}



export {
   quadrangulate,
}
