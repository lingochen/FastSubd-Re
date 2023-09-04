/**
  vec3 utility functions, using (array, index).

*/

const vec2 = {
add: function(out, k, arr0, i, arr1, j) {
   out[k]   = arr0[i]   + arr1[j];
   out[k+1] = arr0[i+1] + arr1[j+1];

   return out;
},

sub: function(out, k, a, i, b, j) {
   out[k]   = a[i] - b[j];
   out[k+1] = a[i+1] - b[j+1];

   return out;
},

copy: function(dest, i, source, j) {
   dest[i]   = source[j];
   dest[i+1] = source[j+1];

   return dest;
},

lerp: function(out, k, arr0, i, arr1, j, u) {
   out[k]   = arr0[i]   + u * (arr1[j]   - arr0[i]);
   out[k+1] = arr0[i+1] + u * (arr1[j+1] - arr0[i+1]);

   return out;
},

scale: function(out, k, arr, i, u) {
   out[k]   = arr[i]   * u;
   out[k+1] = arr[i+1] * u;

   return out;
},

addAndScale: function(out, k, arr0, i, arr1, j, u) {
   out[k]   = (arr0[i]   + arr1[j])   * u;
   out[k+1] = (arr0[j+1] + arr1[j+1]) * u;
 
   return out;
},

scaleAndAdd: function(out, k, arr0, i, arr1, j, u) {
   out[k]   = arr0[i]   + arr1[j]   * u;
   out[k+1] = arr0[i+1] + arr1[j+1] * u;

   return out;
},

}

const vec2a = {

add: function(dest, i, source, j) {
   dest[i]   += source[j];
   dest[i+1] += source[j+1];

   return dest;
},

copy: function(dest, i, source, j) {
   dest[i]   = source[j];
   dest[i+1] = source[j+1];

   return dest;
},

scale: function(dest, i, x) {
   dest[i]   *= x;
   dest[i+1] *= x;

   return dest;
},

addAndScale: function(dest, i, source, j, x) {
   dest[i]   = (dest[i] + source[j]) * x;
   dest[i+1] = (dest[i+1] + source[j+1]) * x;

   return dest;
},

scaleAndAdd: function(dest, i, source, j, x) {
   dest[i]   += source[j]   * x;
   dest[i+1] += source[j+1] * x;

   return dest;
},

}

export {
   vec2,
   vec2a,
}
