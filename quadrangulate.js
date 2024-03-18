/**
 * pairing triangle to form quad, the criteria are
 *  1) pair triangles with longest diagonal.
 *  2) nearly same normal?
 * 
 * this is for mesh color patch, so 2) is not as important?
 */
 
import {SurfaceMesh} from './surfacemesh.js';
import {vec3} from './vec3.js'; 
 

/**
 * step to pairing quad
 * 1) compute wEdges length.
 * 2) every triangles determined it best pair if any. if isolated triangles then removed from list
 * 3) if best pair agreed then the quad is done. the best pair can be removed.
 * 4) loop back to (2) if there is still triangles available. 
 */
function quadrangulate(mesh) {
   // compute all wEdges LengthSquared.
   const wEdgeLength = [];
   const position = mesh.v.positionBuffer();
   for (let [_wEdge, leftH, rightH] of mesh.h) {
      // get origin and dest
      const origin = mesh.h.origin(leftH);
      const dest = mesh.h.origin(rightH);
      let length = vec3.squaredDistance(position, origin*4, position, dest*4);
      wEdgeLength.push(length);
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
            let bestFit = [tri, 0];    // self, at worst an isolated triangle
            // try to find best available pair of triangle.
            for (let hEdge of mesh.f.halfEdgeLoop(tri)) {
               const pair = mesh.h.pair(hEdge);
               if (pair >= 0) {        // not boundary loop, so valid face
                  const candidateFace = mesh.h.face(pair);
                  if (!triangle.paired[candidateFace]) {    // is face not paired yet
                     const wEdge = mesh.h.wEdge(hEdge);
                     const length = wEdgeLength[wEdge];
                     if (length > bestFit[1]) {            // check if better fit?
                        bestFit[0] =  candidateFace;
                        bestFit[1] = length;
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
      for (let tri of mesh.f) {  //
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
   const isolated = new Map;
   for (let tri of mesh.f) {
      if (triangle.bestFit[tri] === tri) {   // isolated triangle, now find neighboring quad
         for (let face of mesh.f.faceAround(tri)) {
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
               if (isolated.has(quadFace)) {
                  console.log("shared isolate");
               }
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
   
   return [quad, tri];
}




export {
   quadrangulate,
}
