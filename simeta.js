var SimpleImageMeta = (function() {
  //simple image meta data
  //use :
  //      var meta = new SimpleImageMeta(image.src);
  //      var info = meta.readInfo();

  var tiffTagTbl = {
    //image constitution
    0x0100 : "ImageWidth",
    0x0101 : "ImageHeight",
    0x0102 : "BitsPerSample",
    0x0103 : "Compression",
    0x0106 : "PhotometricInterpretation",
    0x0112 : "Orientation",
    0x0115 : "SamplesPerPixel",
    0x011C : "PlanarConfiguration",
    0x0212 : "YCbCrSubSampling",
    0x0213 : "YCbCrPositioning",
    0x011A : "XResolution",
    0x011B : "YResolution",
    0x0128 : "ResolutionUnit",
    //image recoding
    0x0111 : "StripOffsets",
    0x0116 : "RowsPerStrip",
    0x0117 : "StripByteCounts",
    0x0201 : "JPEGInterchangeFormat",
    0x0202 : "JPEGInterchangeFormatLength",
    //image characteristic
    0x012D : "TransferFunction",
    0x013E : "WhitePoint",
    0x013F : "PrimaryChromaticities",
    0x0211 : "YCbCrCoefficients",
    0x0214 : "ReferenceBlackWhite",
    //Others
    0x0132 : "DateTime",
    0x010E : "ImageDescription",
    0x010F : "Make",
    0x0110 : "Model",
    0x0131 : "Software",
    0x013B : "Artist",
    0x8298 : "Copyright",
    //Pointer
    0x8769 : "ExifIFDPointer",
    0x8825 : "GPSInfoIFDPointer",
    0xA005 : "InteroperabilityIFDPointer",
  };
  
  var exifTagTbl = {
    // version tags
    0x9000 : "ExifVersion",
    // colorspace tags
    0xA001 : "ColorSpace",
    // image configuration
    0xA002 : "PixelXDimension",
    0xA003 : "PixelYDimension",
    0x9102 : "CompressedBitsPerPixel",
    // user information
    0x927C : "MakerNote",
    0x9286 : "UserComment",
    // related file
    0xA004 : "RelatedSoundFile",
    // date and time
    0x9003 : "DateTimeOriginal",
    0x9004 : "DateTimeDigitized",
    // other tags
    0xA420 : "ImageUniqueID"
  };

  var gpsTagTbl = {
    0x0000 : "GPSVersionID",
    0x0001 : "GPSLatitudeRef",
    0x0002 : "GPSLatitude",
    0x0003 : "GPSLongitudeRef",
    0x0004 : "GPSLongitude",
  };
  
  
  
  var debug = false;
  // constructor

  var SimpleImageMeta = function(data) {
    initialize(this, data);
  };
  
  var initialize = function(me, data) {
    me.data = new DataView(base64ToArrayBuffer(data));
  }
  var base64ToArrayBuffer = function(data) {
    base64 = data.replace(/^data\:([^\;]+)\;base64,/gmi, '');
    var binary_string = window.atob(base64);
    var len = binary_string.length;
    var bytes = new Uint8Array( len );
    for (var i = 0; i < len; i++) {
        bytes[i] = binary_string.charCodeAt(i);
    }
    return bytes.buffer;
  }

  var p = SimpleImageMeta.prototype;
  
  p.reset = function(data) {
    initialize(this, data);
  }
  
  p.readInfo = function() {
    var offset = 0;
    var info;
    if (this.getByteAt(0) == 0xFF && this.getByteAt(1) == 0xD8) {
      info = this.readJPEGInfo();
    }else
    if (this.getByteAt(0) == 0x89 && this.getStringAt(1, 3) == "PNG") {
      info = this.readPNGInfo();
    }else
    if (this.getStringAt(0,3) == "GIF") {
      info = this.readGIFInfo();
    }else
    if (this.getByteAt(0) == 0x42 && this.getByteAt(1) == 0x4D) {
      info = this.readBMPInfo();
    }else
    if (this.getByteAt(0) == 0x00 && this.getByteAt(1) == 0x00) {
      info = this.readICOInfo();
    }else
      return {format : "UNKNOWN"};
    
    info.exif = this.getExif();
    return info;
  };
  
  p.getExif = function() {
    var tagdata = {error:null};
    //if ((this.getByteAt(0) != 0xFF) || (this.getByteAt(1) != 0xD8)) {
    if (this.getUshortAt(0)==0xFFD8) {
      tagdata.error="Not fount SOI(strart of image)";
      return tagdata; // invalid jpeg
    }

    var offset = 2,
      length = this.getLength(),
      marker;

    while (offset < length) {
      if (this.getByteAt(offset++) != 0xFF) {
        tagdata.error="Not found marker prefix";
        return tagdata; // invalid marker, something is wrong
      }
      if (this.getByteAt(offset++) == 0xE1) {
        return this.readAPP1(offset);
      }
      offset += this.getUshortAt(offset, true);
    }
    tagdata.error = "Not found APP1 marker";
    return tagdata;
  }
  
  p.readAPP1 = function(offset) {
    var tagdata = {error:null};
    var length = this.getUshortAt(offset, true);
    offset += 2;
    if (this.getStringAt(offset, 4) != "Exif") {
      tagdata.error="No match identification 'Exif' code";
      return tagdata;
    }

    var bigend,
      tagdata, tag,
      exifData, gpsData,
      tiffstart = offset + 6;

    // test for TIFF validity and endianness
    if (this.getUshortAt(tiffstart) == 0x4949) {
      bigend = false;
    } else if (this.getUshortAt(tiffstart) == 0x4D4D) {
      bigend = true;
    } else {
      tagdata.error="little or big-Endian code error";
      return tagdata;
    }

    if (this.getUshortAt(tiffstart+2, bigend) != 0x002A) {
      tagdata.error="invalid tiff header";
      return tagdata;
    }

    var firstIFDOffset = this.getUlongAt(tiffstart+4, bigend);

    if (firstIFDOffset < 0x00000008) {
      tagdata.error="invalid tiff header";
      return false;
    }

    tagdata = this.readTagData(tiffstart, tiffstart + firstIFDOffset, tiffTagTbl, bigend);

    if (tagdata.ExifIFDPointer) {
      var subData = this.readTagData(tiffstart, tiffstart + tagdata.ExifIFDPointer, exifTagTbl, bigend);
      for (tag in subData) {
        tagdata[tag] = subData[tag];
      }

    }
    
    if (tagdata.GPSInfoIFDPointer) {
      var subData = this.readTagData(tiffstart, 
          tiffstart + tagdata.GPSInfoIFDPointer, gpsTagTbl, bigend);
      for (tag in subData) {
        if (tag == "GPSVersionID") {
          subData[tag] = subData[tag][0] +
            "." + subData[tag][1] +
            "." + subData[tag][2] +
            "." + subData[tag][3];
        }
        tagdata[tag] = subData[tag];
      }
    }

    return tagdata;
  }
  
  p.readTagData = function(start, offset, tagtbl, bigend) {
    var entries = this.getUshortAt(offset, bigend);
    var tagdata = {};
    offset += 2;
    
    for (var i=0; i<entries; i++) {
      var tag = tagtbl[this.getUshortAt(offset, bigend)];
      if (tag) {
        tagdata[tag] = this.readTagValue(start, offset, bigend);
      }
      offset += 12;
    }
    return tagdata;
  }
  
  p.readTagValue = function(start, entry, bigend) {
    var type = this.getUshortAt(entry+2, bigend),
      numVal = this.getUlongAt(entry+4, bigend),
      valOffset = this.getUlongAt(entry+8, bigend) + start,
      vals;
    entry += 8;
    switch (type) {
      case 1: // byte, 8-bit unsigned int
      case 7: // undefined, 8-bit byte, value depending on field
        if (numVal == 1) {
          return this.getByteAt(entry, bigend);
        } else {
          var offset = numVal > 4 ? valOffset : (entry);
          vals = [];
          for (var n=0;n<numVal;n++) {
            vals[n] = this.getByteAt(offset + n);
          }
          return vals;
        }

      case 2: // ascii, 8-bit byte
        {
        var offset = numVal > 4 ? valOffset : (entry);
        return this.getStringAt(offset, numVal-1);
        }

      case 3: // short, 16 bit unsiged int
        if (numVal == 1) {
          return this.getUshortAt(entry, bigend);
        } else {
          var offset = numVal > 2 ? valOffset : (entry);
          vals = [];
          for (var n=0;n<numVal;n++) {
            vals[n] = this.getUshortAt(offset + 2*n, bigend);
          }
          return vals;
        }

      case 4: // long, 32 bit unsiged int
        if (numVal == 1) {
          return this.getUlongAt(entry, bigend);
        } else {
          vals = [];
          for (var n=0;n<numVal;n++) {
            vals[n] = this.getUlongAt(valOffset + 4*n, bigend);
          }
          return vals;
        }

      case 5:  // rational = two long values, first is numerator, second is denominator
        if (numVal == 1) {
          var numerator = this.getUlongAt(valOffset, bigend);
          var denominator = this.getUlongAt(valOffset+4, bigend);
          var val = new Number(numerator / denominator);
          val.numerator = numerator;
          val.denominator = denominator;
          return val;
        } else {
          vals = [];
          for (var n=0;n<numVal;n++) {
            var numerator = this.getUlongAt(valOffset + 8*n, bigend);
            var denominator = this.getUlongAt(valOffset+4 + 8*n, bigend);
            vals[n] = new Number(numerator / denominator);
            vals[n].numerator = numerator;
            vals[n].denominator = denominator;
          }
          return vals;
        }

      case 9: // slong, 32 bit signed int
        if (numVal == 1) {
          return this.getLongAt(entry, bigend);
        } else {
          vals = [];
          for (var n=0;n<numVal;n++) {
            vals[n] = this.getLongAt(valOffset + 4*n, bigend);
          }
          return vals;
        }

      case 10: // signed rational, two slongs, first is numerator, second is denominator
        if (numVal == 1) {
          return this.getLongAt(valOffset, bigend) / this.getLongAt(valOffset+4, bigend);
        } else {
          vals = [];
          for (var n=0;n<numVal;n++) {
            vals[n] = this.getLongAt(valOffset + 8*n, bigend) / this.getLongAt(valOffset+4 + 8*n, bigend);
          }
          return vals;
        }
    }
  }  
  p.readPNGInfo = function() {
    var w = this.getUlongAt(16,true);
    var h = this.getUlongAt(20,true);

    var bpc = this.getByteAt(24); 
    var ct = this.getByteAt(25);
    var bpp = bpc;
    if (ct == 4) bpp *= 2;
    if (ct == 2) bpp *= 3;
    if (ct == 6) bpp *= 4;

    var alpha = this.getByteAt(25) >= 4;
    
    return {
      format : "PNG",
      version : "",
      width : w,
      height : h,
      bpp : bpp,
      alpha : alpha,
    }
  };
  
  p.readGIFInfo = function() {
    var version = this.getStringAt(3,3);
    var w = this.getUshortAt(6);
    var h = this.getUshortAt(8);

    var bpp = ((this.getByteAt(10) >> 4) & 7) + 1;

    return {
      format : "GIF",
      version : version,
      width : w,
      height : h,
      bpp : bpp,
      alpha : false,
    }
  };
  
  p.readJPEGInfo = function() {
    var w = 0;
    var h = 0;
    var comps = 0;
    var len = this.getLength();
    var offset = 2;
    while (offset < len) {
      var marker = this.getUshortAt(offset, true);
      offset += 2;
      if (marker == 0xFFC0) {
        h = this.getUshortAt(offset + 3, true);
        w = this.getUshortAt(offset + 5, true);
        comps = this.getByteAt(offset + 7, true)
        break;
      } else {
        offset += this.getUshortAt(offset, true)
      }
    }


    return {
      format : "JPEG",
      version : "",
      width : w,
      height : h,
      bpp : comps * 8,
      alpha : false,
    }
  };

  p.readBMPInfo = function() {
    var w = this.getUlongAt(18);
    var h = this.getUlongAt(22);
    var bpp = this.getUshortAt(28);
    return {
      format : "BMP",
      version : "",
      width : w,
      height : h,
      bpp : bpp,
      alpha : false,
    }
  };
  
  p.getLength = function() {
    return this.data.byteLength;
  };
  
  p.getStringAt = function(a, len) {
    //return this.data.substr(a, len);
    var str = "";
    while (len-->0)
      str +=  String.fromCharCode(this.getByteAt(a++));
    return str;
  };
  

  p.getByteAt = function(iOffset) {
    return this.data.getUint8(iOffset);
  };
  
  p.getUshortAt = function(iOffset, bigendian) {
    return this.data.getUint16(iOffset, !bigendian);
  };
  
  p.getLongAt = function(iOffset, bigendian) {
    return this.data.getInt32(iOffset, !bigendian);
  }
  p.getUlongAt = function(iOffset, bigendian) {
    return this.data.getUint32(iOffset, !bigendian);
  };
  
  return SimpleImageMeta;
})();
