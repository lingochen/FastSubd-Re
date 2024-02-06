/**
 *  mainly to provide Uint32Array and Float32Array for use.
 * 2023/11/15 - backing buffer changed to be pluggable, either sharedarray or wasm sharable memory.
 * also eliminated auto capacity growth, backing buffer managed by outside 
 * @module PixelArray
 * 
*/


import {computeDataTextureDim, computeDataTextureLen, makeDataTexture, makeDataTexture3D} from './glutil.js';

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
      this._blob = null;               // bufferInfo, byteOffset, length
      this._dataView = null;
      this._set = this._setNoCheck;    // NoCheck as default. Only turn on this._setWithCheck when necessary;
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
         usedSize: 0,                                             // current allocated array in native type
         gpuSize: 0,                                              // current allocated gpu texture in native type.
         alteredMin: 0,                                           // in native type
         alteredMax: -1,
      }
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
         const size = this._dataView.length - this._rec.usedSize;
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
      return this._rec.usedSize * this._pixel.byteCount;
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
   
   /**
    * return only the current used part of typedArray. safe access, creating a new typedArray, slight runtime cost.
    * @returns {typedArray} - subarray of currently used typedArray 
    */
   makeUsedBuffer() {
      return this._dataView.subarray(0, this._rec.usedSize);
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
      const tex = makeDataTexture(gl, buffer, this._pixel.internalFormat, this._pixel.format, this._getType(), this._pixel.channelCount);
      return tex;
   }
   
   getTextureParameter() {
      return {internalFormat: this._pixel.internalFormat,
              format: this._pixel.format,
              channelCount: this._pixel.channelCount,
              type: this._getType(),
             };
   }

   /**
    * get currently changed part of typedArray. (alteredMin, alteredMax). Todo: an hierachy of changed part, 
    * aligned to pixel, much easier to reason about.
    * @returns {Object} - return {offset, subArray} of current changed typedArray.
    */
   getChanged() {
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
   }

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
    * let outside caller manage buffer replacement, so we can shared buffer with other pixelarray
    * pro: efficient, con: complexity on caller.
    * 
    */
   setBuffer(bufferInfo, byteOffset, length) {
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
      if (!length) {
         length = this.length();
      }
      
      const [width, height] = computeDataTextureDim(length, this._rec.pixelStride);

      return (width * height * this._pixel.channelCount * this._pixel.byteCount);
   }
   
   setFill(value) {
      this._fillValue = value;
      this._dataView.fill(this._fillValue);
   }
   
   addToVec2(data, index, field) {
      index = index * this._rec.structStride + field;
      data[0] += this._get(index);
      data[1] += this._get(index+1);
      return data;
   }
      
   _get(index) {
      return this._dataView[index];
   }

   get(index, field) {
      return this._dataView[index*this._rec.structStride + field];
   }

   getVec2(index, field, data) {
      index = index * this._rec.structStride + field;
      data[0] = this._get(index);
      data[1] = this._get(index+1);
      return data;
   }
   
   getVec3(index, field, data) {
      index = index * this._rec.structStride + field;
      data[0] = this._get(index);
      data[1] = this._get(index+1);
      data[2] = this._get(index+2);
      return data;
   }
   
   getVec4(index, field, data) {
      index = index * this._rec.structStride + field;
      data[0] = this._get(index);
      data[1] = this._get(index+1);
      data[2] = this._get(index+2);
      data[3] = this._get(index+3);
      return data;
   }

   _setValues(index, array) {
      this._dataView.set(array, index);
      return true;
   }
   
   _setNoCheck(index, newValue) {
      this._dataView[index] = newValue;
      return true;
   }
   
   _setWithCheck(index, newValue) {
      if (this._dataView[index] !== newValue) {
         this._dataView[index] = newValue;
         if (index < this._rec.alteredMin) {
            this._rec.alteredMin = index;
         }
         if (index > this._rec.alteredMax) {
            this._rec.alteredMax = index;
         }
         return true;
      }
      return false;
   }

   set(index, field, newValue) {
      index = index * this._rec.structStride + field;
      return this._set(index, newValue);
   }
   
   setVec2(index, field, data) {
      index = index * this._rec.structStride + field;
      let ret = this._set(index, data[0]);            // TODO: is it better to use bitwise (!) ?
      ret = this._set(index+1, data[1]) || ret;
      return ret;
   }
   
   setVec3(index, field, data) {
      index = index * this._rec.structStride + field;
      let ret = this._set(index, data[0]);
      ret = this._set(index+1, data[1]) || ret;
      ret = this._set(index+2, data[2]) || ret;
      return ret;
   }
   
   setVec4(index, field, data) {
      index = index * this._rec.structStride + field;
      let ret = this._set(index, data[0]);
      ret = this._set(index+1, data[1]) || ret;
      ret = this._set(index+2, data[2]) || ret;
      ret = this._set(index+3, data[3]) || ret;
      return ret;
   }
   
   _setCheckOn() {
      this._set = this._setWithCheck;
   }  
   
   _setCheckOff() {
      this._set = this._setNoCheck;
   }

   /**
    * after copying memory to gpu, reset the alteredXXX.
    */
   _resetCounter() {
      this._rec.alteredMin = this._blob ? this._blob.length : 0;
      this._rec.alteredMax = -1;
   }

   _resetLength() {
      this._rec.gpuSize = this._rec.usedSize;
   };

   isAltered() {
      return (this._rec.alteredMin <= this._rec.alteredMax);
   };

   isLengthAltered() {
      return (this._rec.gpuSize !== this._rec.usedSize);
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
      return fromHalf( super._get(index) );
   }
   
   get(index, field) {
      return fromHalf( super.get(index, field) );
   }
   
   _setNoCheck(index, newValue) {
      return super._setNoCheck(index, toHalf(newValue) );
   }
   
   _setWithCheck(index, newValue) {
      return super._setWithCheck(index, toHalf(newValue) );
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
   const tex = makeDataTexture3D(gl, uvs, param.internalFormat, param.format, param.type, param.channelCount);
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


/**
 * TODO: deprecated class, to be removed later when we implemented front/back deque like pixelarray for handling negative index.
 */
class DoubleBuffer {
   constructor(buffer, buffer2) {
      this._bufferA = buffer;
      this._bufferB = buffer2;
   }
   
   static dummy = PixelArray.derived.set(this.name, this);   
      
   static rehydrate(self) {
      const bufferA = rehydrateBuffer(self._bufferA);
      const bufferB = rehydrateBuffer(self._bufferB);
      return new DoubleBuffer(bufferA, bufferB);
   }

   getDehydrate(obj) {
      obj.className = this.constructor.name;
      obj._bufferA = this._bufferA.getDehydrate({});
      obj._bufferB = this._bufferB.getDehydrate({});
      return obj;
   }
   
   computeBufferSize(length) {
      return this._bufferA.computeBufferSize(length);    // bufferA and buuferB are the same
   }
   
   setBuffer(buffer, byteOffset, length) {
      return this._bufferA.setBuffer(buffer, byteOffset, length);
      //return this._bufferB.setBuffer(buffer, byteOffset, bLength);
   }
   
   setBufferB(buffer, byteOffset, length) {
      return this._bufferB.setBuffer(buffer, byteOffset, length);
   }
   
   appendRangeNew(size) {
      return this._bufferA.appendRangeNew(size);
   }
   
   getTextureParameter() {
      return this._bufferA.getTextureParameter();   
   }
   
   get(handle, offset) {
      if (handle < 0) {
         return this._bufferB.get(-(handle+1), offset);
      } else {
         return this._bufferA.get(handle, offset);
      }
   }
   
   getVec2(handle, offset, vec) {
      if (handle < 0) {
         return this._bufferB.getVec2(-(handle+1), offset, vec);
      } else {
         return this._bufferA.getVec2(handle, offset, vec);
      }
   }
   
   set(handle, offset, value) {
      if (handle < 0) {
         return this._bufferB.set(-(handle+1), offset, value);
      } else {
         return this._bufferA.set(handle, offset, value);
      }
   }
   
   setVec2(handle, offset, vec) {
      if (handle < 0) {
         return this._bufferB.setVec2(-(handle+1), offset, vec);
      } else {
         return this._bufferA.setVec2(handle, offset, vec);
      }
   }
   
   getBuffer() {
      //return [this._bufferA.getBuffer(), this._bufferB.getBuffer()];
      return this._bufferA.getBuffer();
   }
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
   const array = [];
   const length = type.arraySize ? type.arraySize : 1;
   for (let i = 0; i < length; ++i) {
      const prop = createTextureBuffer(type, size);
      // add fields getter/setter.
      addProp(prop, type.fields);
      array.push( prop );
   }
   if (type.arraySize === undefined) {
      return array[0];
   } else {
      return array;
   }
}

function createDynamicProperty2(type, size, size2) {
   const array = [];
   const length = type.arraySize ? type.arraySize : 1;
   for (let i = 0; i < length; ++i) {
      const buffer = createTextureBuffer(type, size);
      const buffer2 = createTextureBuffer(type, size2);
      const prop = new DoubleBuffer(buffer, buffer2);
      addProp(prop, type.fields);
      array.push(prop);
   }
   if (type.arraySize === undefined) {
      return array[0];
   } else {
      return array;
   }
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


export {
   Uint8PixelArray,
   Int32PixelArray,
   Float32PixelArray,
   Float16PixelArray,
   rehydrateBuffer,
   createDataTexture3D,
   createDynamicProperty,
   createDynamicProperty2,
   allocBuffer,
   freeBuffer,
}
