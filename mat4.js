import {vec3, vec3a} from './vec3.js';



function setValues(m00, m01, m02, m03, 
                   m10, m11, m12, m13, 
                   m20, m21, m22, m23,
                   m30, m31, m32, m33, out) {
   out = out || new Array(16);

   out[0] = m00;
   out[1] = m01;
   out[2] = m02;
   out[3] = m03;
   out[4] = m10;
   out[5] = m11;
   out[6] = m12;
   out[7] = m13;
   out[8] = m20;
   out[9] = m21;
   out[10] = m22;
   out[11] = m23;
   out[12] = m30;
   out[13] = m31;
   out[14] = m32;
   out[15] = m33;

   return out;
}

function frustum(left, right, bottom, top, near, far, out) {
    const dx = right - left;
    const dy = top - bottom;
    const dz = near - far;
    const sx = right + left;
    const sy = top + bottom;
    const nz = far * near;

    return setValues(2*near/dx,         0,      0,  0,
                             0, 2*near/dy,      0,  0,
                         sx/dx,     sy/dy, far/dz, -1,
                             0,         0,  nz/dz,  0, out);
}


function perspective(fovY, aspect, zNear, zFar, out) { 
   const top = zNear * Math.tan(0.5 * fovY * Math.PI / 180.0);
   const bottom = -top;

   const right = top * aspect;
   const left = -right;
   
   return frustum(left, right, bottom, top, zNear, zFar, out);
}


function lookAt(eye, target, up, out) {
   let xAxis = [0, 0, 0];
   let yAxis = [0, 0, 0];
   let zAxis = [0, 0, 0];
   
   vec3.sub(zAxis, 0, eye, 0, target, 0);
   vec3a.normalize(zAxis, 0);
   vec3.cross(xAxis, 0, up, 0, zAxis, 0);
   vec3a.normalize(xAxis, 0);
   vec3.cross(yAxis, 0, zAxis, 0, xAxis, 0);
   vec3a.normalize(yAxis, 0);
   
   return setValues(xAxis[0], xAxis[1], xAxis[2], 0,
                    yAxis[0], yAxis[1], yAxis[2], 0,
                    zAxis[0], zAxis[1], zAxis[2], 0,
                      eye[0],   eye[1],   eye[2], 1, out);
}

function inverse(a, out) {
   const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3],
         a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7],
         a20 = a[8], a21 = a[9], a22 = a[10],a23 = a[11],
         a30 = a[12],a31 = a[13],a32 = a[14],a33 = a[15];

   const b00 = a00 * a11 - a01 * a10,
         b01 = a00 * a12 - a02 * a10,
         b02 = a00 * a13 - a03 * a10,
         b03 = a01 * a12 - a02 * a11,
         b04 = a01 * a13 - a03 * a11,
         b05 = a02 * a13 - a03 * a12,
         b06 = a20 * a31 - a21 * a30,
         b07 = a20 * a32 - a22 * a30,
         b08 = a20 * a33 - a23 * a30,
         b09 = a21 * a32 - a22 * a31,
         b10 = a21 * a33 - a23 * a31,
         b11 = a22 * a33 - a23 * a32;

   // Calculate the determinant
   let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;

// if (det === 0) {
//   return null;
// }
   
   det = 1.0 / det;

   // set values
   out = out || new Array(16);
 
   out[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det;
   out[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
   out[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det;
   out[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
   out[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det;
   out[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
   out[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det;
   out[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
   out[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det;
   out[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
   out[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det;
   out[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
   out[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det;
   out[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
   out[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det;
   out[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;

   return out;
}

function rotationY(radY, out) {
   const c = Math.cos(radY);
   const s = Math.sin(radY);
 
   return setValues(c, 0, -s, 0,
                    0, 1,  0, 0,
                    s, 0,  c, 0,
                    0, 0,  0, 1, out);
}

function identity(out) {
   if (!out) {
      out = new Array(16);
   }
   
   out[0] = 1;
   out[1] = 0;
   out[2] = 0;
   out[3] = 0;

   out[4] = 0;
   out[5] = 1;
   out[6] = 0;
   out[7] = 0;

   out[8] = 0;
   out[9] = 0;
   out[10] = 1;
   out[11] = 0;

   out[12] = 0;
   out[13] = 0;
   out[14] = 0;
   out[15] = 1;

  return out;

}

export {
   identity,
   setValues,
   frustum,
   perspective,
   lookAt,
   inverse,
   rotationY,
}
