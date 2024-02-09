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
            if ((info.type === "sampler2D") || (info.type === "sampler2DArray")) {
               locations[key].unit = programInfo.textureUnit++;
            }
         }
      }
      // initialized
      if (locations[key]) {
         setUniform(gl, locations[key], info);
      } else {
         console.log("no uniform: " + key);
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


function updatePullBufferInfo(gl, buffer, pullBuffer) {
   gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
   gl.bufferData(gl.ARRAY_BUFFER, pullBuffer, gl.STATIC_DRAW);
   
   // return with triangle count
   return {buffer, count: pullBuffer.length/3};    // 3 items per vertex.
}

function drawPullBuffer(gl, program, pullInfo) {
   const loc = gl.getAttribLocation(program.program, "a_pullVertex");
   gl.bindBuffer(gl.ARRAY_BUFFER, pullInfo.buffer);
   gl.vertexAttribIPointer(0, 3, gl.INT, 3*4, 0);
   gl.enableVertexAttribArray(0);
   gl.bindAttribLocation(program.program, 0, "a_pullVertex");
   // now draw, with size
   gl.drawArrays(gl.TRIANGLES, 0, pullInfo.count);
}



let MAX_TEXTURE_SIZE = 0;
function setConstant(gl) {
   MAX_TEXTURE_SIZE = gl.getParameter(gl.MAX_TEXTURE_SIZE);
};


function makeDataTexture(gl, internalFormat, format, type, data, length, pixelStride) {
   let [width, height] = computeDataTextureDim(length, pixelStride);

   const tex = gl.createTexture();
   gl.activeTexture(gl.TEXTURE0);
   gl.bindTexture(gl.TEXTURE_2D, tex);
   
   _dontFilter2D(gl);
   // allocate image
//   gl.texStorage2D(gl.TEXTURE_2D,
//     1,                    // 1 level only
//     internalFormat,
//     width, height);
   
   // copy texture
   gl.texImage2D(gl.TEXTURE_2D,
     0,                    // base image
     internalFormat,       // format
     width, height, 0,     // width, height, border(0)
     format, type,
     data
   );
   
   return tex;
};


/**
 * @param {int} start - the start of buffer index
 * @param {int} end - the end of buffer index
 */
function _updateDataTexture(texSubImage, pixelType, start, end) {
   start = Math.floor(start / pixelType);
   const startX = start % MAX_TEXTURE_SIZE;
   const startY = Math.floor(start / MAX_TEXTURE_SIZE);
   end = Math.floor((end+pixelType-1) / pixelType);  // it should align to pixelSize, no needs for (pixelType-1), but...
   const endX = end % (MAX_TEXTURE_SIZE);
   const endY= Math.floor((end-1) / MAX_TEXTURE_SIZE);
   
   // now copy data over.
   // part 1, starting line
   let yStart = startY;
   let width = MAX_TEXTURE_SIZE-startX;
   if ((startX > 0) || (yStart === endY)) {  // must do startLine, cannot merge
      if (startY === endY) {
         width = endX - startX;
         if (width === 0) {
            width = MAX_TEXTURE_SIZE;
         }
      }
      texSubImage(startX, startY, width, 1);
      yStart++;
   }
    
   // do middle rectangle if any
   if (yStart < endY) {
      width = MAX_TEXTURE_SIZE;
      let height = endY - yStart;
      if (endX === MAX_TEXTURE_SIZE) { // merge endline
         height++;
      }
      texSubImage(0, yStart, width, height);
      yStart += height;
   }
      
   // part 3, end line if any
   if (yStart === endY) {
      texSubImage(0, yStart, endX, 1);
   }
}

function _dontFilter2D(gl) {
   // don't do filtering
   gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
   gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

   gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
   gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);      
}
/**
 * update gpu data texture, reflect the change in cpu's data 
 * 
 */
function updateDataTexture(gl, texID, data, internalFormat, format, type, pixelType, start, end) {
   // select texture
   gl.activeTexture(gl.TEXTURE0);
   gl.bindTexture(gl.TEXTURE_2D, texID);
   
   // now, copy the data to gpu
   //_dontFilter2D(gl);
   _updateDataTexture((x, y, width, height)=>{
            gl.texSubImage2D(gl.TEXTURE_2D, 0,
               x, y, width, height,
               format, type, data.subarray(x + y*MAX_TEXTURE_SIZE));
         },
         pixelType, start, end);
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
      gl.texImage3D(gl.TEXTURE_2D_ARRAY,
         0,                         // base image
         internalFormat,
         width, height, i, 0,
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
   updatePullBufferInfo,
   drawPullBuffer,
   resizeCanvasToDisplaySize,
}
