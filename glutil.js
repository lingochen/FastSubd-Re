/**
 glUtil

*/

function setUniform(gl, setter, uniformInfo) {
   switch (uniformInfo.type) {
      case "i":
         gl.uniform1i(setter.loc, uniformInfo.value);
         break;
      case "ivec3":
         gl.uniform3iv(setter.loc, uniformInfo.value);
      break;
      case "vec3":
         gl.uniform3fv(setter.loc, uniformInfo.value);
      break;
      case "ivec4":
         gl.uniform4iv(setter.loc, uniformInfo.value);
      break;
      case "vec4":
         gl.uniform4fv(setter.loc, uniformInfo.value);
      break;
      case "mat4":
         gl.uniformMatrix4fv(setter.loc, false, uniformInfo.value);
      break;
      case "sampler2D":
         gl.activeTexture(gl.TEXTURE0 + setter.unit);
         gl.bindTexture(gl.TEXTURE_2D, uniformInfo.value);
         gl.uniform1i(setter.loc, setter.unit);
      break;
      case "isampler2D":
         gl.activeTexture(gl.TEXTURE0 + setter.unit);
         gl.bindTexture(gl.TEXTURE_2D, uniformInfo.value);
         gl.uniform1i(setter.loc, setter.unit);
      break;
      case "sampler2DArray":
         gl.activeTexture(gl.TEXTURE0 + setter.unit);
         gl.bindTexture(gl.TEXTURE_2D_ARRAY, uniformInfo.value);
         gl.uniform1i(setter.loc, setter.unit);
      break;
      default:
         console.log("not supported type: " + uniformInfo.type);
   }
}

function setUniforms(gl, programInfo, uniformInfos) {
   let locations = programInfo.uniforms;
   for (let [key, info] of Object.entries(uniformInfos)) {
      if (!locations[key]) {  // initialized if not already
         const loc = gl.getUniformLocation(programInfo.program, key);
         if (loc !== null) {
            locations[key] = {loc};
            if ((info.type === "isampler2D") || (info.type === "sampler2D") || (info.type === "sampler2DArray")) {
               locations[key].unit = programInfo.textureUnit++;
            }
         }
      }
      // initialized
      if (locations[key]) {
         setUniform(gl, locations[key], info);
      } else {
         console.log("no uniform: " + key + " used in this shader");
      }
   }
}


function createProgram(gl, vs, fs) {
   const vShader = gl.createShader(gl.VERTEX_SHADER);
   gl.shaderSource(vShader, vs);
   gl.compileShader(vShader);

   const fShader = gl.createShader(gl.FRAGMENT_SHADER);
   gl.shaderSource(fShader, fs);
   gl.compileShader(fShader);
   
   const program = gl.createProgram();
   
   gl.attachShader(program, vShader);
   gl.attachShader(program, fShader);

   gl.linkProgram(program);

   if ( !gl.getProgramParameter(program, gl.LINK_STATUS) ) {
      const info = gl.getProgramInfoLog(program);
      throw 'Could not compile WebGL program. \n\n' + info;
   }

   return {program, uniforms: {}, textureUnit: 0};
}


function drawPull(gl, program, pullLength) {
   gl.drawArraysInstanced(gl.TRIANGLES, 0, 3, Math.floor(pullLength/3));
}



let MAX_TEXTURE_SIZE = 0;
function setConstant(gl) {
   MAX_TEXTURE_SIZE = gl.getParameter(gl.MAX_TEXTURE_SIZE);
   gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
};


function _dontFilter2D(gl) {
   // don't do filtering
   gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
   gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

   gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
   gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);      
}

function makeDataTexture(gl, internalFormat, format, type, data, length, pixelStride) {
   let [width, height] = computeDataTextureDim(length, pixelStride);

   const tex = gl.createTexture();
   gl.activeTexture(gl.TEXTURE0);
   gl.bindTexture(gl.TEXTURE_2D, tex);
   
   
   _dontFilter2D(gl);
   // allocate image
   gl.texStorage2D(gl.TEXTURE_2D,
     1,                    // 1 level only
     internalFormat,
     width, height);
   
   // copy texture
   gl.texSubImage2D(gl.TEXTURE_2D,
     0,                    // base image
     0, 0, width, height,  // x, y, width, height,
     format, type,
     data
   );
   
   return tex;
};



/**
 * update gpu data texture, reflect the change in cpu's data 
 * 
 */
function updateDataTexture(gl, texID, data, internalFormat, format, type, pixelType, start, end) {
   // select texture
   gl.activeTexture(gl.TEXTURE0);
   gl.bindTexture(gl.TEXTURE_2D, texID);
   
   //_dontFilter2D(gl);
   
   // TODO: copied the change data.
   
   
}


function makeDataTexture3D(gl, internalFormat, format, type, data, length, pixelStride) {   
   const numImages = data.length;   // slices
   const [width, height] = computeDataTextureDim(length, pixelStride);
    
   const texture = gl.createTexture();
   // -- Init Texture
   gl.activeTexture(gl.TEXTURE0);
   gl.bindTexture(gl.TEXTURE_2D_ARRAY, texture);
   // we don't need any filtering
   gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
   gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
   gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);

   gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
   gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
   
   // allocated image
   gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 
      1,                            // 1 image, no mipmap
      internalFormat,
      width, height, numImages,
   );
   // now copy over to gpu
   for (let i = 0; i < numImages; ++i) {
      gl.texSubImage3D(gl.TEXTURE_2D_ARRAY,
         0,                            // base image
         0, 0, i, width, height, 1,    // xoffset, yoffset, zoffset, width, height, depth,
         format, type,
         data[i]      
      );
   }
   
   return texture;
};


function defaultSampler(gl) {
      const options = {
         format: gl.RGBA,
         type: gl.UNSIGNED_BYTE,
         magFilter: gl.LINEAR,
         minFilter: gl.LINEAR,
         wrapS: gl.REPEAT,//gl.CLAMP_TO_EDGE;
         wrapT: gl.REPEAT,//gl.CLAMP_TO_EDGE;
         flipY: false,
         unit: 0,
         // channel: -1,
      };
      return options;
}


function setImage(gl, handle, image, sampler) {
      //image = gl.resizeImage(image);

      gl.activeTexture(gl.TEXTURE0+7);                // use baseColorTexture position to update.
      gl.bindTexture(gl.TEXTURE_2D, handle);
      if (sampler.flipY) {
         gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
      }
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, sampler.magFilter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, sampler.minFilter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, sampler.wrapS);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, sampler.wrapT);      
      gl.texImage2D(gl.TEXTURE_2D, 0, sampler.format, sampler.format, sampler.type, image);
      
      if ((sampler.minFilter != gl.NEAREST) && (sampler.minFilter != gl.LINEAR)) {
        gl.generateMipmap(gl.TEXTURE_2D);
      }
      if (sampler.flipY) { // restore to default setting
         gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
      }
}


function setWHITE(gl, whiteHandle) {
   gl.activeTexture(gl.TEXTURE0+7);                // use baseColorTexture position to update.
   gl.bindTexture(gl.TEXTURE_2D, whiteHandle);
   // Fill the texture with a 1x1 white pixel.
   gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));
}


let CHECKERBOARD;
function getCHECKERBOARD() {
   if (!CHECKERBOARD) {
      const c = document.createElement('canvas').getContext('2d');
      c.canvas.width = c.canvas.height = 128;
      for (var y = 0; y < c.canvas.height; y += 16) {
         for (var x = 0; x < c.canvas.width; x += 16) {
            c.fillStyle = (x ^ y) & 16 ? '#FFF' : '#DDD';
            c.fillRect(x, y, 16, 16);
         }
      }
      CHECKERBOARD = c.canvas;
   }
   
   return CHECKERBOARD;
};



function resizeCanvasToDisplaySize(canvas, multiplier) {
   multiplier = multiplier || 1;
   multiplier = Math.max(0, multiplier);
   const width  = canvas.clientWidth  * multiplier | 0;
   const height = canvas.clientHeight * multiplier | 0;
   if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
      return true;
   }
   return false;
}

/**
 * vertical preferred rect texture. compute the (width, height) given an array length and stride
 * @param {int} length - array length
 * @param {int} stride - # of pixelElement of the object's structure.
 * @return {int, int} (width, height) - data texture dimension.
 */
function computeDataTextureDim(length, stride) {
   let height = length;
   let width = Math.ceil(length / MAX_TEXTURE_SIZE);
   if (width > 1) {
      height = Math.ceil(length / width);     // align to texture rect
   }
   
   width *= stride;
   if (width > MAX_TEXTURE_SIZE) {
      //width = height = 0;
      throw("data texture > than MAX_TEXTURE_SIZE: " + width);
   }
   
   return [width, height];
}

/**
 * given an array length, compute the length that will fitted the dataTexture's rect dimension.
 * 
 */
function computeDataTextureLen(length) {
   const [width, height] = computeDataTextureDim(length, 1);
   return (width * height);
}


export {
   makeDataTexture,
   makeDataTexture3D,
   getCHECKERBOARD,
   defaultSampler,
   setImage,
   setWHITE,
   setConstant,
   MAX_TEXTURE_SIZE,
   computeDataTextureDim,
   computeDataTextureLen,
   createProgram,
   setUniforms,
   drawPull,
   resizeCanvasToDisplaySize,
}
