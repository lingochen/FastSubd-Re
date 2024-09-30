/**
 *  mainly to provide Uint32Array and Float32Array for use.
 * 2023/11/15 - backing buffer changed to be pluggable, either sharedarray or wasm sharable memory.
 * backing buffer can be managed by outside caller, but still provide the option of auto expansion.
 * 
 * 2024/02/15 - add the ability to prepend before index Zero. using negative int to access it.
 * 
 * @module PixelArray
 * 
*/

import {computeDataTextureDim, computeDataTextureLen, expandAllocLen, makeDataTexture, makeDataTexture3D} from './glutil.js';

/** webgl2 constant. copied only what we needs texturing data. */
const PixelTypeK = {
   BYTE: 0x1400,
   UNSIGNED_BYTE: 0x1401,
   SHORT: 0x1402,
   UNSIGNED_SHORT: 0x1403,
   INT: 0x1404,
   UNSIGNED_INT: 0x1405,
   HALF_FLOAT: 0x140B,
   FLOAT: 0x1406,
};
Object.freeze(PixelTypeK);
const PixelFormatK = {
   RED: 0x1903,
   RED_INTEGER: 0x8D94,
   RG: 0x8227,
   RG_INTEGER: 0x8228,
   RGB: 0x1907,
   RGB_INTEGER: 0x8D98,
   RGBA: 0x1908,
   RGBA_INTEGER: 0x8D99,
};
Object.freeze(PixelFormatK);
const PixelInternalFormatK = {
   R8: 0x8229,
   RG8: 0x822B,
   RGB8: 0x8051,
   RGBA8: 0x8058,
   R32I: 0x8235,
   RG32I: 0x823B,
   RGB32I: 0x8D83,
   RGBA32I: 0x8D82,
   RG16F: 0x822F,
   RGB16F: 0x881B,
   R32F: 0x822E,
   RG32F: 0x8230,
   RGB32F: 0x8815,
   RGBA32F: 0x8814,
}
Object.freeze(PixelInternalFormatK);



/** class managing typedArray so that it can be used as gpu Texture directly. */
class PixelArray {
   // should be called by create/workerCopy only.
   constructor(pixel, record) {
      this._pixel = pixel;
      this._rec = record;
      this._blob = null;                     // bufferInfo, byteOffset, length
      this._dataView = null;
      this._indexPos = this._alteredNotSet;  // NoCheck as default. Only turn on this._setWithCheck when necessary;
      this._altered = {                      // position in native types
         min: [0, 0],                        // 0th is front, 1st is back
         max: [-1, -1],
      }
      // altered min
      this._fillValue = 0;
   }
   
   // https://stackoverflow.com/questions/31618212/find-all-classes-in-a-javascript-application-that-extend-a-base-class
   static derived = new Map;

   /**
    * create typedArray with specfic type.
    * @param {number} structSize - the size of structure we want to represent
    * @param {number} channelPrecision - # of bytes of TypedArray typed.
    * @param {number} channelCount - # of channels per pixel. ie.. (rgba) channels.
    * @param {number} internalFormat - specific precision format.
    * @param {number} pixelFormat - webgl format.
    */
   static _createInternal(structSize, channelPrecision, channelCount, internalFormat, pixelFormat) {
      //this._structSize = structSize;
      const pixel = {
         byteCount: channelPrecision,                             // pixelArray type in byte.
         channelCount: channelCount,                              // number of channels per pixel. ie.. (rgba) channels
         internalFormat, internalFormat,
         format: pixelFormat,                                     // the real webgl format.
      };
      const stride = Math.ceil(structSize/channelCount);
      const record = {
         structStride: stride*channelCount,                       // number of pixels to store a structure.
         pixelStride: stride,
      //this._allocatedStruct = 0;                                   // number of structure allocated.
         gpuSize: 0,                                              // current allocated gpu texture in native type. total size
         usedSize: 0,                                             // current allocated array in native type
         usedSizePre: 0,                                          // allocated array in front, before Zero, (in implementation, start at back end of array)
      };
      //self._set = this._setWithCheck;
      return [pixel, record];
   }

   getDehydrate(obj) {
      obj.className = this.constructor.name;
      obj._pixel = this._pixel;
      obj._rec = this._rec;
      if (this._blob) {
         obj._sharedBuffer = {
            buffer: this._blob.bufferInfo.buffer, 
            byteOffset: this._blob.byteOffset,
            length: this._blob.length
         };
      } else {
         obj._sharedBuffer = {
            buffer: null,
            byteOffet: 0,
            length: 0
         };
      }
      return obj;
   }
   
   static rehydrate(self) {
      if (self._pixel && self._rec && self._sharedBuffer) {
         const ret = new this(self._pixel, self._rec, null);                        // (this) is the class object, will called the correct constructor 
         if (self._sharedBuffer.length > 0) {
            const bufferInfo = {buffer: self._sharedBuffer.buffer, refCount: 1};    // TODO: dummy refCount to prevent deletion. is this the best way?
            ret.setBuffer(bufferInfo, self._sharedBuffer.byteOffset, self._sharedBuffer.length);
         }
         return ret;
      }
      throw(this.className + " rehydrate: bad input");
   }
   
   /**
    * the size from length() to buffer end's.
    * of slots still available for allocation. negative meant overflow
    */
   capacity() {
      if (this._dataView) {
         const size = this._dataView.length - this._rec.usedSize - this._rec.usedSizePre;
         return (size / this._rec.structStride);
      } else {
         return 0;
      }
   }

   /**
    * get total byte length
    * @returns {number} - total used bytes.
    */
   byteLength() {
      return (this._rec.usedSize+this._rec.usedSizePre) * this._pixel.byteCount;
   }
   
   /**
    * get the struct length
    * @returns {number} - current used length. not typed length but struct length
    */
   length() {
      return (this._rec.usedSize / this._rec.structStride);
   }
   
   /**
    * the maximum capacity.
    */
   maxLength() {
      if (this._blob) {
         return this._blob.length;
      } else {
         return 0;
      }
   }

   /**
    * return typedArray including unused part. unsafed access but no extra runtime cost.
    * @returns {typedArray} -  
    */
   getBuffer() {
      return this._dataView;
   }
   
   isValidDataTexture() {
      const length = this.maxLength();
      const rectLen = computeDataTextureLen(length);
      if (length !== rectLen) {
         throw("dataTexture size not padded to rect(width, height) size");
      }
      return true;
   }

   createDataTexture(gl) {
      // make sure dataView is padded toe dataTextureRect dimension.
      this.isValidDataTexture();
      const buffer = this.getBuffer();
      const tex = makeDataTexture(gl, this._pixel.internalFormat, this._pixel.format, this._getType(), buffer, this.maxLength(), this._rec.pixelStride);
      return tex;
   }
   
   getTextureParameter() {
      return {internalFormat: this._pixel.internalFormat,
              format: this._pixel.format,
              type: this._getType(),
              length: this.maxLength(),
              pixelStride: this._rec.pixelStride,
             };
   }

   /**
    * get currently changed part of typedArray. (alteredMin, alteredMax). Todo: an hierachy of changed part, 
    * aligned to pixel, much easier to reason about.
    * @returns {Object} - return {offset, subArray} of current changed typedArray.
    */
/*   getChanged() {
      let start = Math.floor(this._rec.alteredMin/this._rec.structStride) * this._rec.structStride;
      let end =  (Math.floor(this._rec.alteredMax/this._rec.structStride)+1) * this._rec.structStride;
      return {byteOffset: start*this._pixel.byteCount,
              array: this._dataView.subarray(start, end)};
   }

   getInterval(formatChannel) {
      const ret = {start: 0, end: 0};
      if (this.isAltered()) {
         ret.start = Math.floor(this._rec.alteredMin/formatChannel) * formatChannel;
         ret.end =  (Math.floor(this._rec.alteredMax/formatChannel)+1) * formatChannel;
      }
      return ret;
   }*/

   //
   // delegate to appendRangeNew
   appendNew() {
      return this.appendRangeNew(1);
   }
   
   //
   // expand() delegated to owner.
   //
   appendRangeNew(size) {
      const index = this._rec.usedSize / this._rec.structStride;
      this._rec.usedSize += this._rec.structStride * size;
      //if (this._rec.usedSize > this._blob.length) {
      //   this.expand(this._rec.usedSize);
      //}
      return index;
   }
   
   //
   // rename from dealloc. remove from end
   // real buffer is allocated from outside.
   //
   shrink(size) {
      this._rec.usedSize -= this._rec.structStride * size;
      // return new end index
      return this._rec.useSize / this._rec.structStride;
   }
   
   /**
    *TODO: 
    */
   shrinkPre(size) {
   
   }
   
   /**
    * let outside caller manage buffer replacement, so we can shared buffer with other pixelarray
    * pro: efficient, con: complexity on caller.
    * 
    */
   setBuffer(bufferInfo, byteOffset, length) {
      if (isNaN(length)) {
         throw("nan detected");
      }
      const dataView = this._createView(bufferInfo.buffer, byteOffset, length*this._rec.structStride);
      if (this._dataView) { // remember to copy old blob if any.
         dataView.set(this._dataView.subarray(0, this.length()));
      }
      // release refCount buffer if we are the last reference.
      if (this._blob) {
         if (--this._blob.bufferInfo.refCount === 0) {
            freeBuffer(this._blob.bufferInfo.buffer);
         }
      }
      // now setup the newBuffer and the copied View.
      this._blob = {bufferInfo, byteOffset, length};
      ++bufferInfo.refCount;
      this._dataView = dataView;
      
      // return new byteOffset
      return byteOffset + dataView.byteLength;
   }
   
   /**
    * compute buffer size that is padded to dataTexture's rect dimension.
    */
   computeBufferSize(length) {
      if (isNaN(length)) {
         throw("Nan detected");
         return 0;
      }
         
      const [width, height] = computeDataTextureDim(length, this._rec.pixelStride);

      return (width * height * this._pixel.channelCount * this._pixel.byteCount);
   }
   
   setFill(value) {
      this._fillValue = value;
      this._dataView?.fill(this._fillValue);
   }
   
   addToVec2(data, index, field) {
      index = index * this._rec.structStride + field;
      if (index < 0) {
         index += this._dataView.length;
      }
      data[0] += this._get(index);
      data[1] += this._dataView[index+1];
      return data;
   }
      
   _get(index) {
      return this._dataView[index];
   }
   
   _set(index, newValue) {
      this._dataView[index] = newValue;
   }

   /*
    * let _get() which is override in Float16, handle getting the data,
    * get() only compute the real index position. 
    */
   get(index, field) {
      index = index*this._rec.structStride + field;
      if (index < 0) {
         index += this._dataView.length;
      }
      return this._get(index);
   }

   getVec2(index, field, data) {
      index = index * this._rec.structStride + field;
      if (index < 0) {
         index += this._dataView.length;
      }
      data[0] = this._get(index);
      data[1] = this._get(index+1);
      return data;
   }
   
   getVec3(index, field, data) {
      index = index * this._rec.structStride + field;
      if (index < 0) {
         index += this._dataView.length;
      }
      data[0] = this._get(index);
      data[1] = this._get(index+1);
      data[2] = this._get(index+2);
      return data;
   }
   
   getVec4(index, field, data) {
      index = index * this._rec.structStride + field;
      if (index < 0) {
         index += this._dataView.length;
      }
      data[0] = this._get(index);
      data[1] = this._get(index+1);
      data[2] = this._get(index+2);
      data[3] = this._get(index+3);
      return data;
   }

   set(index, field, newValue) {
      index = this._indexPos(index, field, 1);
      this._set(index, newValue);
      return newValue;
   }
   
   setValue2(index, field, data0, data1) {
      index = this._indexPos(index, field, 2);
      this._set(index, data0);
      this._set(index+1, data1);
   }
   
   setVec2(index, field, data) {
      index = this._indexPos(index, field, 2);
      this._set(index, data[0]);                // NOTE: we don't use set because the data might be larger than 2 data.
      this._set(index+1, data[1]);
      return data;
   }
   
   setVec3(index, field, data) {
      index = this._indexPos(index, field, 3);
      this._set(index, data[0]);
      this._set(index+1, data[1]);
      this._set(index+2, data[2]);
      return data;
   }
   
   setVec4(index, field, data) {
      index = this._indexPos(index, field, 4);
      this._set(index, data[0]);
      this._set(index+1, data[1]);
      this._set(index+2, data[2]);
      this._set(index+3, data[3]);
      return data;
   }
   
   _setAlteredOn() {
      this._indexPos = this._alteredSet;
   }  
   
   _setAlteredOff() {
      this._indexPos = this._alteredNotSet;
   }

   /**
    * after copying memory to gpu, reset the alteredXXX.
    */
   _resetAlteredCounter() {
      this._altered.minFront = this._altered.minBack = this._blob ? this._blob.length : 0;
      this._altered.maxFront = this._altered.maxBack = -1;
   }

   isAltered() {
      return (this._altered.min[0] <= this._altered.max[1]) ||
              (this._altered.min[1] <= this._altered.max[1]);
   };
   
   _alteredNotSet(index, field, length) {
      index = index * this._rec.structStride + field;
/*      if (index < 0) {
         index += this._dataView.length;
      }*/
      return index;
   }
   
   _alteredSet(index, field, length) {
      index = index * this._rec.structStride + field;
      let altId = 0;
      if (index < 0) {
         index += this._dataView.length;
         altId = 1;
      }
      if (index < this._altered.min[altId]) {
         this._altered.min[altId] = index;
      } 
      let indexEnd = index + length;
      if (indexEnd > this._altered.max[altId]) {
         this._altered.max[altId] = indexEnd;
      }
      return index;
   }
}


class Uint8PixelArray extends PixelArray {
   constructor(pixel, record, blob) {
      super(pixel, record, blob);
   }
   
   static dummy = PixelArray.derived.set(this.name, this);
   
   static create(structSize, numberOfChannel) {
      let format = PixelFormatK.RED_INTEGER;
      let internalFormat = PixelInternalFormatK.R8;
      switch (numberOfChannel) {
         case 1:
            break;
         case 2:
            format = PixelFormatK.RG_INTEGER;
            internalFormat = PixelInternalFormatK.RG8;
            break;
        case 3:
            format = PixelFormatK.RGB_INTEGER;
            internalFormat = PixelInternalFormatK.RGB8;
            break;
        case 4:
            format = PixelFormatK.RGBA_INTEGER;
            internalFormat = PixelInternalFormatK.RGBA8;
            break;
        default:
           console.log("Unsupport # of pixel channel: " + numberOfChannel);
      }
      // buffer will be set on outside.
      const [pixel, record] = PixelArray._createInternal(structSize, 1, numberOfChannel, internalFormat, format);
      return new Uint8PixelArray(pixel, record, null);
   }
   
   //
   // buffer - sharedarraybuffer or "shared wasm buffer"
   // offset - offset to the buffer
   // length - the number of items of this particular type
   _createView(buffer, byteOffset, length) {
      return new Uint8Array(buffer, byteOffset, length);
   }

   _getType() {
      return PixelTypeK.UNSIGNED_BYTE;
   }
}



class Int32PixelArray extends PixelArray {
   constructor(pixel, record, blob) {
      super(pixel, record, blob);
   }
   
   static dummy = PixelArray.derived.set(this.name, this);

   static create(structSize, numberOfChannel) {
      let format = PixelFormatK.RED_INTEGER;
      let internalFormat = PixelInternalFormatK.R32I;
      switch (numberOfChannel) {
         case 1:
            break;
         case 2:
            format = PixelFormatK.RG_INTEGER;
            internalFormat = PixelInternalFormatK.RG32I;
            break;
        case 3:
            format = PixelFormatK.RGB_INTEGER;
            internalFormat = PixelInternalFormatK.RGB32I;
            break;
        case 4:
            format = PixelFormatK.RGBA_INTEGER;
            internalFormat = PixelInternalFormatK.RGBA32I;
            break;
        default:
           console.log("Unsupport # of pixel channel: " + numberOfChannel);
      }
      // caller remember to setBuffer()
      const [pixel, record] = PixelArray._createInternal(structSize, 4, numberOfChannel, internalFormat, format);
      return new Int32PixelArray(pixel, record, null);
   }
   
   _createView(buffer, offset, length) {
      return new Int32Array(buffer, offset, length);
   }

   _getType() {
      return PixelTypeK.INT;
   }
}



class Float32PixelArray extends PixelArray {
   constructor(pixel, record, blob) {
      super(pixel, record, blob);
   }
   
   static dummy = PixelArray.derived.set(this.name, this);   

   static create(structSize, numberOfChannel) {
      let format = PixelFormatK.RED;
      let internalFormat = PixelInternalFormatK.R32F;
      switch (numberOfChannel) {
        case 1:
           break;
        case 2:
           format = PixelFormatK.RG;
           internalFormat = PixelInternalFormatK.RG32F;
           break;
        case 3:
           format = PixelFormatK.RGB;
           internalFormat = PixelInternalFormatK.RGB32F;
           break;
        case 4:
           format = PixelFormatK.RGBA;
           internalFormat = PixelInternalFormatK.RGBA32F;
           break;
        default:
           console.log("Unsupport # of pixel channel: " + numberOfChannel);
      }
      // buffer set by the caller
      const [pixel, record] = PixelArray._createInternal(structSize, 4, numberOfChannel, internalFormat, format);
      return new Float32PixelArray(pixel, record, null);
   }
   
   _createView(buffer, byteOffset, length) {
      return new Float32Array(buffer, byteOffset, length);
   }

   _getType() {
      return PixelTypeK.FLOAT;
   }
}



class Float16PixelArray extends PixelArray {
   constructor(pixel, record, blob) {
      super(pixel, record, blob);
   }
   
   static dummy = PixelArray.derived.set(this.name, this);   

   static create(structSize, numberOfChannel) {
      let format = PixelFormatK.RG;
      let internalFormat = PixelInternalFormatK.RG16F;
      switch (numberOfChannel) {
        case 2:
           break;
        case 3:
           format = PixelFormatK.RGB;
           internalFormat = PixelInternalFormatK.RGB16F;
           break;
        case 1:
           format = PixelFormatK.RED;
           internalFormat = PixelInternalFormatK.R16F;
           break;
        case 4:
        default:
           console.log("Unsupport # of pixel channel: " + numberOfChannel);
      }
      
      // caller to setBuffer().
      const [pixel, record] = PixelArray._createInternal(structSize, 2, numberOfChannel, internalFormat, format);
      return new Float16PixelArray(pixel, record, null);
   }
   
   _createView(buffer, byteOffset, length) {
      return new Uint16Array(buffer, byteOffset, length);
   }
   
   _getType() {
      return PixelTypeK.HALF_FLOAT;
   }
   
   _get(index) {
      return fromHalf( this._dataView[index] );
   }
   
   _set(index, newValue) {
      this._dataView[index] = toHalf(newValue);
   }
}





/*******************************************************************************
 * 32bit to 16bit float encoding/decoding functions. 
 */
/**
 * Candidate for WASM.
 * https://stackoverflow.com/questions/32633585/how-do-you-convert-to-half-floats-in-javascript
 */
const toHalf = (function() {
   let floatView = new Float32Array(1);
   let int32View = new Int32Array(floatView.buffer);
 
   // This method is faster than the OpenEXR implementation (very often
   // used, eg. in Ogre), with the additional benefit of rounding, inspired
   // by James Tursa?s half-precision code. 
   return function toHalf(value) {
     floatView[0] = value;     // float32 conversion here
     var x = int32View[0];
 
     var bits = (x >> 16) & 0x8000; // Get the sign 
     var m = (x >> 12) & 0x07ff; // Keep one extra bit for rounding 
     var e = (x >> 23) & 0xff; // Using int is faster here 
 
     // If zero, or denormal, or exponent underflows too much for a denormal half, return signed zero. 
     if (e < 103) {
       return bits;
     }
 
     // If NaN, return NaN. If Inf or exponent overflow, return Inf. 
     if (e > 142) {
       bits |= 0x7c00;
       // If exponent was 0xff and one mantissa bit was set, it means NaN, not Inf, so make sure we set one mantissa bit too. 
       bits |= ((e == 255) ? 0 : 1) && (x & 0x007fffff);
       return bits;
     }
 
     // If exponent underflows but not too much, return a denormal
     if (e < 113) {
       m |= 0x0800;
       // Extra rounding may overflow and set mantissa to 0 and exponent to 1, which is OK.
       bits |= (m >> (114 - e)) + ((m >> (113 - e)) & 1);
       return bits;
     }
 
     bits |= ((e - 112) << 10) | (m >> 1);
     // Extra rounding. An overflow will set mantissa to 0 and increment the exponent, which is OK. 
     bits += m & 1;
     return bits;
   }
}());

/**
 * 
 * https://stackoverflow.com/questions/5678432/decompressing-half-precision-floats-in-javascript
 */
const fromHalf = function(binary) {
   let exponent = (binary & 0x7C00) >> 10, 
       fraction = binary & 0x03FF;
   return (binary >> 15 ? -1 : 1) * 
           (exponent ? 
               (exponent === 0x1F ? (fraction ? NaN : Infinity) : Math.pow(2, exponent - 15) * (1 + fraction / 0x400)) 
               : 6.103515625e-5 * (fraction / 0x400)
            );
};


const createDataTexture3D = function(array, gl) {
   const uvs = [];
   const param = array[0].getTextureParameter();
   for (let uv of array) {
      uvs.push( uv.getBuffer() );
   }
   const tex = makeDataTexture3D(gl, param.internalFormat, param.format, param.type, uvs, param.length, param.pixelStride);
   return tex;
}



function rehydrateBuffer(obj) {
   const classObj = PixelArray.derived.get(obj.className);
   if (classObj) {
      return classObj.rehydrate(obj);
   } else {
      throw("non-existence class: " + obj.className);
   }
}

/**
 * padded the offset so it align on 64 bytes boundary.
 * why 64 bytes? alignment on cache boundary. current standard.
 */
function alignCache(byteOffset) {
   return Math.floor((byteOffset + 63) / 64) * 64;
}


//
// type = {className, fields, sizeOf, numberOfChannel, initialSize}
//
function createTextureBuffer(type) {
   const classObj = PixelArray.derived.get(type.className);
   if (classObj) {
      return classObj.create(type.sizeOf, type.numberOfChannel, type.initialSize);
   } else {
      throw("non-existence class: " + obj.className);
   }
}

function addProp(obj, fields) {
   for (let key of Object.keys(fields)) {
      const [offset, size] = fields[key];
      const getter = `get${key}`;
      const setter = `set${key}`;
      if (size <= 1) {
         obj[getter] = function(handle) {
            return this.get(handle, offset);
         };
         obj[setter] = function(handle, value) {
            return this.set(handle, offset, value);
         }
      } else if (size === 2) {
         obj[getter] = function(handle, vec) {
            return this.getVec2(handle, offset, vec);
         }
         obj[setter] = function(handle, vec) {
            return this.setVec2(handle, offset, vec);
         }
      } else if (size === 3) {
         obj[getter] = function(handle, vec) {
            return this.getVec3(handle, offset, vec);
         }
         obj[setter] = function(handle, vec) {
            return this.setVec2(handle, offset, vec);
         }
      } else if (size === 4) {
         obj[getter] = function(handle, vec) {
            return this.getVec4(handle, offset, vec);
         }
         obj[setter] = function(handle, vec) {
            return this.setVec4(handle, offset, vec);
         }
      } else {
         throw("unsupport size: " + size);
      }
   }
}

function createDynamicProperty(type, size) {
   const prop = createTextureBuffer(type, size);
   // add fields getter/setter.
   addProp(prop, type.fields);
      
   return prop;
}

   
/**
 * eventually transition to WebAssembly linear memory
 */
function allocBuffer(totalBytes) {
   return {buffer: new SharedArrayBuffer(totalBytes), refCount: 0};
}

/**
 * eventually transition to WASM lineary memory
 */
function freeBuffer(buffer) {
   // do nothing for now
}   
   


/**
 * let browser decided if it validVarName, copy from stackoverflow
 */
function isValidVarName(name) {
   try {
      Function('var ' + name);
   } catch(e) {
      return false;
   }
   return true;
}


class ExtensiblePropertyArray {
   constructor(base, prop, freePool) {
      this._base = base;
      this._prop = prop;
      // freed array slot memory manager.
      this._freeMM = Object.assign( {     // provide default
            stride: 1, pos: 0,
            size: 0, head: 0} ,
            freePool);
   }
   
   dehydrateObject(obj) {
      if (obj) {
         const json = {};
         for (let [key, prop] of Object.entries(obj)) {
            json[key] = prop.getDehydrate({});
         }
   
         return json;
      }
      throw("dehydrate object does not exist");
   }
   
   static rehydrateObject(json) {
      if (json) {
         const retObj = {};
         for (let [key, prop] of Object.entries(json)) {
            retObj[key] = rehydrateBuffer(prop);
         }
         return retObj;
      }
      throw("rehydrate json does not exist");
   }
   
   _rehydrate(self) {
      if (self._base && self._prop) {
         this._base = this.constructor.rehydrateObject(self._base);
         this._prop = this.constructor.rehydrateObject(self._prop);
         this._freeMM = self._freeMM;
      } else {
         throw("no internal memeber, bad input.");
      }
   }

   getDehydrate(obj) {
      obj._base = this.dehydrateObject(this._base);
      obj._prop = this.dehydrateObject(this._prop);
      obj._freeMM = this._freeMM;
      
      return obj;
   }
   
   alloc() {
      return this.allocArray(1)[0];
   }
   
   allocArray(count) {
      let size = Math.min(this._freeMM.size, count);
      
      this._freeMM.size -= size;
      const free = [];
      for (; size > 0; --size) {
         free.push( this._head );                  // last in, first out.
         this._head = this._freeSlot.get(this._freeMM.head, this._freeMM.pos); 
      }
      
      count -= free.length;
      // check if we needs more allocation.
      if (count > 0) {
         if (this._freeSlot.capacity() < count) { // resize array if not enough free space.
            this.setBuffer(null, 0, expandAllocLen( this._freeSlot.maxLength()+count ) );
         }
         
         const index = this._allocArray(count);
         
         for (let i = 0; i < count; ++i) {
            free.push( i+index );
         }
      }
      
      return free;
   }
   
   _allocArray(count) {
      const index = this._allocEx(count);
      this._alloc(count);
      return index;
   }
   
   /**
    * base and extended property allocation.
    */
   _alloc(count) {
      for (let prop of this.properties() ) {
         prop.appendRangeNew(count);
      }
   }
   
   /**
    * extra allocation by subClass. override if needed to be
    */
   _allocEx(_count) {
      // ovrride if needed to be.
      
      // return the start of new allocation.
      return this._freeSlot.length();
   }
   
   free(handle) {
      this._freeSlot.set(handle, 0, this._freeMM.head);
      this._freeMM.head= handle;
      this._freeMM.size++;
      
   }
   
   _hasFree() {
      return this._freeMM.size > 0;
   }
   
   /**
    * 
    */
   computeBufferSize(length) {
      let totalSize = 0;
      for (let prop of this.properties()) {
         totalSize += alignCache(prop.computeBufferSize(length));;
      }
      return totalSize;
   }
   
   /**
    * use new buffer with length as capacity
    */
   setBuffer(bufferInfo, byteOffset, length) {
      if (!bufferInfo) {   // no buffer, so that meant new separate buffer
         bufferInfo = allocBuffer(this.computeBufferSize(length));
      }
      
      for (let prop of this.properties()) {
         byteOffset = alignCache(prop.setBuffer(bufferInfo, byteOffset, length));
      }
      
      return byteOffset;
   }
   
   _appendRangeNew(size, pixArray) {
      if (pixArray.capacity() < size) {
         this.setBuffer(null, 0, expandAllocLen( pixArray.maxLength()+size ) );
      }
      
      let index;
      for (let prop of this.properties()) {
         index = prop.appendRangeNew(size);
      }
      
      return index;
   }
   
   addProperty(name, type) {
      //if (isValidVarName(name)) {
         if (this._prop[name] === undefined) { // don't already exist
            // create DynamicProperty for accessing data
            this._prop[name] = createDynamicProperty(type, this.length());
            return this._prop[name];
         }
      //}
      return false;
   }
   
   getProperty(name, index) {
      if (index === undefined) {
         return this._prop[name];
      } else {
         return this._prop[name][index];
      }
   }
   
   removeProperty(name) {
      if (this._prop[name]) {
         delete this._prop[name];
         return true;
      }
      return false;
   }   
   
   /**
    * iterator. can be override 
    * 
    */
   * properties() {
      yield* Object.values(this._base);
      yield* Object.values(this._prop);
   }

   /**
    * add up objs pixelbuffers's structure size in bytes, with length and cache alignment.
    */
   static totalStructSize(objs, length) {
      let totalByte = 0;
      for (let buffer of Object.values(objs)) {
         totalByte += alignCache(buffer.computeBufferSize(length));
      }
      return totalByte;
   }

   /**
    * iterate over the array, setBuffer accordingly.
    */
   static setBufferAll(objs, bufferInfo, byteOffset, length) {
      for (let buffer of Object.values(objs)) {
         byteOffset = alignCache(buffer.setBuffer(bufferInfo, byteOffset, length));
      }
      return byteOffset;
   }
}



export {
   Uint8PixelArray,
   Int32PixelArray,
   Float32PixelArray,
   Float16PixelArray,
   rehydrateBuffer,
   createDataTexture3D,
   allocBuffer,
   freeBuffer,
   ExtensiblePropertyArray,
}
