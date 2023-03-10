let THREE = require('three');
/*
 * @author fernandojsg / http://fernandojsg.com
 * @author Don McCurdy / https://www.donmccurdy.com
 * @author Takahiro / https://github.com/takahirox
 */

//------------------------------------------------------------------------------
//Constants
//------------------------------------------------------------------------------
let WEBGL_CONSTANTS = {
  POINTS: 0x0000,
  LINES: 0x0001,
  LINE_LOOP: 0x0002,
  LINE_STRIP: 0x0003,
  TRIANGLES: 0x0004,
  TRIANGLE_STRIP: 0x0005,
  TRIANGLE_FAN: 0x0006,

  UNSIGNED_BYTE: 0x1401,
  UNSIGNED_SHORT: 0x1403,
  FLOAT: 0x1406,
  UNSIGNED_INT: 0x1405,
  ARRAY_BUFFER: 0x8892,
  ELEMENT_ARRAY_BUFFER: 0x8893,

  NEAREST: 0x2600,
  LINEAR: 0x2601,
  NEAREST_MIPMAP_NEAREST: 0x2700,
  LINEAR_MIPMAP_NEAREST: 0x2701,
  NEAREST_MIPMAP_LINEAR: 0x2702,
  LINEAR_MIPMAP_LINEAR: 0x2703,
};

let THREE_TO_WEBGL = {
  // @TODO Replace with computed property name [THREE.*] when available on
  // es6
  1003: WEBGL_CONSTANTS.NEAREST,
  1004: WEBGL_CONSTANTS.NEAREST_MIPMAP_NEAREST,
  1005: WEBGL_CONSTANTS.NEAREST_MIPMAP_LINEAR,
  1006: WEBGL_CONSTANTS.LINEAR,
  1007: WEBGL_CONSTANTS.LINEAR_MIPMAP_NEAREST,
  1008: WEBGL_CONSTANTS.LINEAR_MIPMAP_LINEAR,
};

let PATH_PROPERTIES = {
  scale: 'scale',
  position: 'translation',
  quaternion: 'rotation',
  morphTargetInfluences: 'weights',
};

let _GLTFExporter = (function () {
  //	------------------------------------------------------------------------------
  //	GLTF Exporter
  //	------------------------------------------------------------------------------
  function GLTFExporter() {}

  GLTFExporter.prototype = {
    constructor: GLTFExporter,

    /*
     * Parse scenes and generate GLTF output
     *
     * @param {THREE.Scene
     *            or [THREE.Scenes]} input THREE.Scene or Array of
     *            THREE.Scenes
     * @param {Function}
     *            onDone Callback on completed
     * @param {Object}
     *            options options
     */
    parse: function (input, onDone, options) {
      let DEFAULT_OPTIONS = {
        binary: false,
        trs: false,
        onlyVisible: true,
        truncateDrawRange: true,
        embedImages: true,
        animations: [],
        forceIndices: false,
        forcePowerOfTwoTextures: false,
      };

      options = Object.assign({}, DEFAULT_OPTIONS, options);

      if (options.animations.length > 0) {
        // Only TRS properties, and not matrices, may be targeted by
        // animation.
        options.trs = true;
      }

      let outputJSON = {
        asset: {
          version: '2.0',
          generator: 'THREE.GLTFExporter',
        },
      };

      let byteOffset = 0;
      let buffers = [];
      let pending = [];
      let nodeMap = new Map();
      let skins = [];
      let extensionsUsed = {};
      let cachedData = {
        attributes: new Map(),
        materials: new Map(),
        textures: new Map(),
        images: new Map(),
      };

      let cachedCanvas;

      /*
       * Compare two arrays
       */
      /*
       * Compare two arrays
       *
       * @param {Array}
       *            array1 Array 1 to compare
       * @param {Array}
       *            array2 Array 2 to compare
       * @return {Boolean} Returns true if both arrays are equal
       */
      function equalArray(array1, array2) {
        return (
          array1.length === array2.length &&
          array1.every(function (element, index) {
            return element === array2[index];
          })
        );
      }

      /*
       * Converts a string to an ArrayBuffer.
       *
       * @param {string}
       *            text
       * @return {ArrayBuffer}
       */
      function stringToArrayBuffer(text) {
        if (window.TextEncoder !== undefined) {
          return new TextEncoder().encode(text).buffer;
        }

        let array = new Uint8Array(new ArrayBuffer(text.length));

        for (let i = 0, il = text.length; i < il; i++) {
          let value = text.charCodeAt(i);

          // Replacing multi-byte character with space(0x20).
          array[i] = value > 0xff ? 0x20 : value;
        }

        return array.buffer;
      }

      /*
       * Get the min and max vectors from the given attribute
       *
       * @param {THREE.BufferAttribute}
       *            attribute Attribute to find the min/max in range
       *            from start to start + count
       * @param {Integer}
       *            start
       * @param {Integer}
       *            count
       * @return {Object} Object containing the `min` and `max` values
       *         (As an array of attribute.itemSize components)
       */
      function getMinMax(attribute, start, count) {
        let output = {
          min: new Array(attribute.itemSize).fill(Number.POSITIVE_INFINITY),
          max: new Array(attribute.itemSize).fill(Number.NEGATIVE_INFINITY),
        };

        for (let i = start; i < start + count; i++) {
          for (let a = 0; a < attribute.itemSize; a++) {
            let value = attribute.array[i * attribute.itemSize + a];
            output.min[a] = Math.min(output.min[a], value);
            output.max[a] = Math.max(output.max[a], value);
          }
        }

        return output;
      }

      /*
       * Checks if image size is POT.
       *
       * @param {Image}
       *            image The image to be checked.
       * @returns {Boolean} Returns true if image size is POT.
       *
       */
      function isPowerOfTwo(image) {
        return (
          THREE.Math.isPowerOfTwo(image.width) &&
          THREE.Math.isPowerOfTwo(image.height)
        );
      }

      /*
       * Checks if normal attribute values are normalized.
       *
       * @param {THREE.BufferAttribute}
       *            normal
       * @returns {Boolean}
       *
       */
      function isNormalizedNormalAttribute(normal) {
        if (cachedData.attributes.has(normal)) {
          return false;
        }

        let v = new THREE.Vector3();

        for (let i = 0, il = normal.count; i < il; i++) {
          // 0.0005 is from glTF-validator
          if (
            Math.abs(v.fromArray(normal.array, i * 3).length() - 1.0) > 0.0005
          )
            return false;
        }

        return true;
      }

      /*
       * Creates normalized normal buffer attribute.
       *
       * @param {THREE.BufferAttribute}
       *            normal
       * @returns {THREE.BufferAttribute}
       *
       */
      function createNormalizedNormalAttribute(normal) {
        if (cachedData.attributes.has(normal)) {
          return cachedData.attributes.get(normal);
        }

        let attribute = normal.clone();

        let v = new THREE.Vector3();

        for (let i = 0, il = attribute.count; i < il; i++) {
          v.fromArray(attribute.array, i * 3);

          if (v.x === 0 && v.y === 0 && v.z === 0) {
            // if values can't be normalized set (1, 0, 0)
            v.setX(1.0);
          } else {
            v.normalize();
          }

          v.toArray(attribute.array, i * 3);
        }

        cachedData.attributes.set(normal, attribute);

        return attribute;
      }

      /*
       * Get the required size + padding for a buffer, rounded to the
       * next 4-byte boundary.
       * https://github.com/KhronosGroup/glTF/tree/master/specification/2.0#data-alignment
       *
       * @param {Integer}
       *            bufferSize The size the original buffer.
       * @returns {Integer} new buffer size with required padding.
       *
       */
      function getPaddedBufferSize(bufferSize) {
        return Math.ceil(bufferSize / 4) * 4;
      }

      /*
       * Returns a buffer aligned to 4-byte boundary.
       *
       * @param {ArrayBuffer}
       *            arrayBuffer Buffer to pad
       * @param {Integer}
       *            paddingByte (Optional)
       * @returns {ArrayBuffer} The same buffer if it's already
       *          aligned to 4-byte boundary or a new buffer
       */
      function getPaddedArrayBuffer(arrayBuffer, paddingByte) {
        paddingByte = paddingByte || 0;

        let paddedLength = getPaddedBufferSize(arrayBuffer.byteLength);

        if (paddedLength !== arrayBuffer.byteLength) {
          let array = new Uint8Array(paddedLength);
          array.set(new Uint8Array(arrayBuffer));

          if (paddingByte !== 0) {
            for (let i = arrayBuffer.byteLength; i < paddedLength; i++) {
              array[i] = paddingByte;
            }
          }

          return array.buffer;
        }

        return arrayBuffer;
      }

      /*
       * Serializes a userData.
       *
       * @param {THREE.Object3D|THREE.Material}
       *            object
       * @returns {Object}
       */
      function serializeUserData(object) {
        try {
          return JSON.parse(JSON.stringify(object.userData));
        } catch (error) {
          console.warn(
            "THREE.GLTFExporter: userData of '" +
              object.name +
              "' " +
              "won't be serialized because of JSON.stringify error - " +
              error.message,
          );

          return {};
        }
      }

      /*
       * Process a buffer to append to the default one.
       *
       * @param {ArrayBuffer}
       *            buffer
       * @return {Integer}
       */
      function processBuffer(buffer) {
        if (!outputJSON.buffers) {
          outputJSON.buffers = [{ byteLength: 0 }];
        }

        // All buffers are merged before export.
        buffers.push(buffer);

        return 0;
      }

      /*
       * Process and generate a BufferView
       *
       * @param {THREE.BufferAttribute}
       *            attribute
       * @param {number}
       *            componentType
       * @param {number}
       *            start
       * @param {number}
       *            count
       * @param {number}
       *            target (Optional) Target usage of the BufferView
       * @return {Object}
       */
      function processBufferView(
        attribute,
        componentType,
        start,
        count,
        target,
      ) {
        if (!outputJSON.bufferViews) {
          outputJSON.bufferViews = [];
        }

        // Create a new dataview and dump the attribute's array into
        // it

        let componentSize;

        if (componentType === WEBGL_CONSTANTS.UNSIGNED_BYTE) {
          componentSize = 1;
        } else if (componentType === WEBGL_CONSTANTS.UNSIGNED_SHORT) {
          componentSize = 2;
        } else {
          componentSize = 4;
        }

        let byteLength = getPaddedBufferSize(
          count * attribute.itemSize * componentSize,
        );
        let dataView = new DataView(new ArrayBuffer(byteLength));
        let offset = 0;

        for (let i = start; i < start + count; i++) {
          for (let a = 0; a < attribute.itemSize; a++) {
            // @TODO Fails on InterleavedBufferAttribute, and
            // could probably be
            // optimized for normal BufferAttribute.
            let value = attribute.array[i * attribute.itemSize + a];

            if (componentType === WEBGL_CONSTANTS.FLOAT) {
              dataView.setFloat32(offset, value, true);
            } else if (componentType === WEBGL_CONSTANTS.UNSIGNED_INT) {
              dataView.setUint32(offset, value, true);
            } else if (componentType === WEBGL_CONSTANTS.UNSIGNED_SHORT) {
              dataView.setUint16(offset, value, true);
            } else if (componentType === WEBGL_CONSTANTS.UNSIGNED_BYTE) {
              dataView.setUint8(offset, value);
            }

            offset += componentSize;
          }
        }

        let gltfBufferView = {
          buffer: processBuffer(dataView.buffer),
          byteOffset: byteOffset,
          byteLength: byteLength,
        };

        if (target !== undefined) gltfBufferView.target = target;

        if (target === WEBGL_CONSTANTS.ARRAY_BUFFER) {
          // Only define byteStride for vertex attributes.
          gltfBufferView.byteStride = attribute.itemSize * componentSize;
        }

        byteOffset += byteLength;

        outputJSON.bufferViews.push(gltfBufferView);

        // @TODO Merge bufferViews where possible.
        let output = {
          id: outputJSON.bufferViews.length - 1,
          byteLength: 0,
        };

        return output;
      }

      /*
       * Process and generate a BufferView from an image Blob.
       *
       * @param {Blob}
       *            blob
       * @return {Promise<Integer>}
       */
      function processBufferViewImage(blob) {
        if (!outputJSON.bufferViews) {
          outputJSON.bufferViews = [];
        }

        return new Promise(function (resolve) {
          let reader = new window.FileReader();
          reader.readAsArrayBuffer(blob);
          reader.onloadend = function () {
            let buffer = getPaddedArrayBuffer(reader.result);

            let bufferView = {
              buffer: processBuffer(buffer),
              byteOffset: byteOffset,
              byteLength: buffer.byteLength,
            };

            byteOffset += buffer.byteLength;

            outputJSON.bufferViews.push(bufferView);

            resolve(outputJSON.bufferViews.length - 1);
          };
        });
      }

      /*
       * Process attribute to generate an accessor
       *
       * @param {THREE.BufferAttribute}
       *            attribute Attribute to process
       * @param {THREE.BufferGeometry}
       *            geometry (Optional) Geometry used for truncated
       *            draw range
       * @param {Integer}
       *            start (Optional)
       * @param {Integer}
       *            count (Optional)
       * @return {Integer} Index of the processed accessor on the
       *         "accessors" array
       */
      function processAccessor(attribute, geometry, start, count) {
        let types = {
          1: 'SCALAR',
          2: 'VEC2',
          3: 'VEC3',
          4: 'VEC4',
          16: 'MAT4',
        };

        let componentType;

        // Detect the component type of the attribute array (float,
        // uint or ushort)
        if (attribute.array.constructor === Float32Array) {
          componentType = WEBGL_CONSTANTS.FLOAT;
        } else if (attribute.array.constructor === Uint32Array) {
          componentType = WEBGL_CONSTANTS.UNSIGNED_INT;
        } else if (attribute.array.constructor === Uint16Array) {
          componentType = WEBGL_CONSTANTS.UNSIGNED_SHORT;
        } else if (attribute.array.constructor === Uint8Array) {
          componentType = WEBGL_CONSTANTS.UNSIGNED_BYTE;
        } else {
          throw new Error(
            'THREE.GLTFExporter: Unsupported bufferAttribute component type.',
          );
        }

        if (start === undefined) start = 0;
        if (count === undefined) count = attribute.count;

        // @TODO Indexed buffer geometry with drawRange not
        // supported yet
        if (
          options.truncateDrawRange &&
          geometry !== undefined &&
          geometry.index === null
        ) {
          let end = start + count;
          let end2 =
            geometry.drawRange.count === Infinity
              ? attribute.count
              : geometry.drawRange.start + geometry.drawRange.count;

          start = Math.max(start, geometry.drawRange.start);
          count = Math.min(end, end2) - start;

          if (count < 0) count = 0;
        }

        // Skip creating an accessor if the attribute doesn't have
        // data to export
        if (count === 0) {
          return null;
        }

        let minMax = getMinMax(attribute, start, count);

        let bufferViewTarget;

        // If geometry isn't provided, don't infer the target usage
        // of the bufferView. For
        // animation samplers, target must not be set.
        if (geometry !== undefined) {
          bufferViewTarget =
            attribute === geometry.index
              ? WEBGL_CONSTANTS.ELEMENT_ARRAY_BUFFER
              : WEBGL_CONSTANTS.ARRAY_BUFFER;
        }

        let bufferView = processBufferView(
          attribute,
          componentType,
          start,
          count,
          bufferViewTarget,
        );

        let gltfAccessor = {
          bufferView: bufferView.id,
          byteOffset: bufferView.byteOffset,
          componentType: componentType,
          count: count,
          max: minMax.max,
          min: minMax.min,
          type: types[attribute.itemSize],
        };

        if (!outputJSON.accessors) {
          outputJSON.accessors = [];
        }

        outputJSON.accessors.push(gltfAccessor);

        return outputJSON.accessors.length - 1;
      }

      /*
       * Process image
       *
       * @param {Image}
       *            image to process
       * @param {Integer}
       *            format of the image (e.g. THREE.RGBFormat,
       *            THREE.RGBAFormat etc)
       * @param {Boolean}
       *            flipY before writing out the image
       * @return {Integer} Index of the processed texture in the
       *         "images" array
       */
      function processImage(image, format, flipY) {
        if (!cachedData.images.has(image)) {
          cachedData.images.set(image, {});
        }

        let cachedImages = cachedData.images.get(image);
        let mimeType = format === THREE.RGBAFormat ? 'image/png' : 'image/jpeg';
        let key = mimeType + ':flipY/' + flipY.toString();

        if (cachedImages[key] !== undefined) {
          return cachedImages[key];
        }

        if (!outputJSON.images) {
          outputJSON.images = [];
        }

        let gltfImage = { mimeType: mimeType };

        if (options.embedImages) {
          let canvas = (cachedCanvas =
            cachedCanvas || document.createElement('canvas'));

          canvas.width = image.width;
          canvas.height = image.height;

          if (options.forcePowerOfTwoTextures && !isPowerOfTwo(image)) {
            console.warn(
              'GLTFExporter: Resized non-power-of-two image.',
              image,
            );

            canvas.width = THREE.Math.floorPowerOfTwo(canvas.width);
            canvas.height = THREE.Math.floorPowerOfTwo(canvas.height);
          }

          let ctx = canvas.getContext('2d');

          if (flipY === true) {
            ctx.translate(0, canvas.height);
            ctx.scale(1, -1);
          }

          ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

          if (options.binary === true) {
            pending.push(
              new Promise(function (resolve) {
                canvas.toBlob(function (blob) {
                  processBufferViewImage(blob).then(function (bufferViewIndex) {
                    gltfImage.bufferView = bufferViewIndex;

                    resolve();
                  });
                }, mimeType);
              }),
            );
          } else {
            gltfImage.uri = canvas.toDataURL(mimeType);
          }
        } else {
          gltfImage.uri = image.src;
        }

        outputJSON.images.push(gltfImage);

        let index = outputJSON.images.length - 1;
        cachedImages[key] = index;

        return index;
      }

      /*
       * Process sampler
       *
       * @param {Texture}
       *            map Texture to process
       * @return {Integer} Index of the processed texture in the
       *         "samplers" array
       */
      function processSampler(map) {
        if (!outputJSON.samplers) {
          outputJSON.samplers = [];
        }

        let gltfSampler = {
          magFilter: THREE_TO_WEBGL[map.magFilter],
          minFilter: THREE_TO_WEBGL[map.minFilter],
          wrapS: THREE_TO_WEBGL[map.wrapS],
          wrapT: THREE_TO_WEBGL[map.wrapT],
        };

        outputJSON.samplers.push(gltfSampler);

        return outputJSON.samplers.length - 1;
      }

      /*
       * Process texture
       *
       * @param {Texture}
       *            map Map to process
       * @return {Integer} Index of the processed texture in the
       *         "textures" array
       */
      function processTexture(map) {
        if (cachedData.textures.has(map)) {
          return cachedData.textures.get(map);
        }

        if (!outputJSON.textures) {
          outputJSON.textures = [];
        }

        let gltfTexture = {
          sampler: processSampler(map),
          source: processImage(map.image, map.format, map.flipY),
        };

        outputJSON.textures.push(gltfTexture);

        let index = outputJSON.textures.length - 1;
        cachedData.textures.set(map, index);

        return index;
      }

      /*
       * Process material
       *
       * @param {THREE.Material}
       *            material Material to process
       * @return {Integer} Index of the processed material in the
       *         "materials" array
       */
      function processMaterial(material) {
        if (cachedData.materials.has(material)) {
          return cachedData.materials.get(material);
        }

        if (!outputJSON.materials) {
          outputJSON.materials = [];
        }

        if (material.isShaderMaterial) {
          console.warn('GLTFExporter: THREE.ShaderMaterial not supported.');
          return null;
        }

        // @QUESTION Should we avoid including any attribute that
        // has the default value?
        let gltfMaterial = {
          pbrMetallicRoughness: {},
        };

        if (material.isMeshBasicMaterial) {
          gltfMaterial.extensions = { KHR_materials_unlit: {} };

          extensionsUsed['KHR_materials_unlit'] = true;
        } else if (!material.isMeshStandardMaterial) {
          console.warn(
            'GLTFExporter: Use MeshStandardMaterial or MeshBasicMaterial for best results.',
          );
        }

        // pbrMetallicRoughness.baseColorFactor
        let color = material.color.toArray().concat([material.opacity]);

        if (!equalArray(color, [1, 1, 1, 1])) {
          gltfMaterial.pbrMetallicRoughness.baseColorFactor = color;
        }

        if (material.isMeshStandardMaterial) {
          gltfMaterial.pbrMetallicRoughness.metallicFactor = material.metalness;
          gltfMaterial.pbrMetallicRoughness.roughnessFactor =
            material.roughness;
        } else if (material.isMeshBasicMaterial) {
          gltfMaterial.pbrMetallicRoughness.metallicFactor = 0.0;
          gltfMaterial.pbrMetallicRoughness.roughnessFactor = 0.9;
        } else {
          gltfMaterial.pbrMetallicRoughness.metallicFactor = 0.5;
          gltfMaterial.pbrMetallicRoughness.roughnessFactor = 0.5;
        }

        // pbrMetallicRoughness.metallicRoughnessTexture
        if (material.metalnessMap || material.roughnessMap) {
          if (material.metalnessMap === material.roughnessMap) {
            gltfMaterial.pbrMetallicRoughness.metallicRoughnessTexture = {
              index: processTexture(material.metalnessMap),
            };
          } else {
            console.warn(
              'THREE.GLTFExporter: Ignoring metalnessMap and roughnessMap because they are not the same Texture.',
            );
          }
        }

        // pbrMetallicRoughness.baseColorTexture
        if (material.map) {
          gltfMaterial.pbrMetallicRoughness.baseColorTexture = {
            index: processTexture(material.map),
          };
        }

        if (
          material.isMeshBasicMaterial ||
          material.isLineBasicMaterial ||
          material.isPointsMaterial
        ) {
        } else {
          // emissiveFactor
          let emissive = material.emissive
            .clone()
            .multiplyScalar(material.emissiveIntensity)
            .toArray();

          if (!equalArray(emissive, [0, 0, 0])) {
            gltfMaterial.emissiveFactor = emissive;
          }

          // emissiveTexture
          if (material.emissiveMap) {
            gltfMaterial.emissiveTexture = {
              index: processTexture(material.emissiveMap),
            };
          }
        }

        // normalTexture
        if (material.normalMap) {
          gltfMaterial.normalTexture = {
            index: processTexture(material.normalMap),
          };

          if (material.normalScale.x !== -1) {
            if (material.normalScale.x !== material.normalScale.y) {
              console.warn(
                'THREE.GLTFExporter: Normal scale components are different, ignoring Y and exporting X.',
              );
            }

            gltfMaterial.normalTexture.scale = material.normalScale.x;
          }
        }

        // occlusionTexture
        if (material.aoMap) {
          gltfMaterial.occlusionTexture = {
            index: processTexture(material.aoMap),
          };

          if (material.aoMapIntensity !== 1.0) {
            gltfMaterial.occlusionTexture.strength = material.aoMapIntensity;
          }
        }

        // alphaMode
        if (material.transparent || material.alphaTest > 0.0) {
          gltfMaterial.alphaMode = material.opacity < 1.0 ? 'BLEND' : 'MASK';

          // Write alphaCutoff if it's non-zero and different from
          // the default (0.5).
          if (material.alphaTest > 0.0 && material.alphaTest !== 0.5) {
            gltfMaterial.alphaCutoff = material.alphaTest;
          }
        }

        // doubleSided
        if (material.side === THREE.DoubleSide) {
          gltfMaterial.doubleSided = true;
        }

        if (material.name !== '') {
          gltfMaterial.name = material.name;
        }

        if (Object.keys(material.userData).length > 0) {
          gltfMaterial.extras = serializeUserData(material);
        }

        outputJSON.materials.push(gltfMaterial);

        let index = outputJSON.materials.length - 1;
        cachedData.materials.set(material, index);

        return index;
      }

      /*
       * Process mesh
       *
       * @param {THREE.Mesh}
       *            mesh Mesh to process
       * @return {Integer} Index of the processed mesh in the "meshes"
       *         array
       */
      function processMesh(mesh) {
        let geometry = mesh.geometry;

        let mode;

        // Use the correct mode
        if (mesh.isLineSegments) {
          mode = WEBGL_CONSTANTS.LINES;
        } else if (mesh.isLineLoop) {
          mode = WEBGL_CONSTANTS.LINE_LOOP;
        } else if (mesh.isLine) {
          mode = WEBGL_CONSTANTS.LINE_STRIP;
        } else if (mesh.isPoints) {
          mode = WEBGL_CONSTANTS.POINTS;
        } else {
          if (!geometry.isBufferGeometry) {
            let geometryTemp = new THREE.BufferGeometry();
            geometryTemp.fromGeometry(geometry);
            geometry = geometryTemp;
          }

          if (mesh.drawMode === THREE.TriangleFanDrawMode) {
            console.warn(
              'GLTFExporter: TriangleFanDrawMode and wireframe incompatible.',
            );
            mode = WEBGL_CONSTANTS.TRIANGLE_FAN;
          } else if (mesh.drawMode === THREE.TriangleStripDrawMode) {
            mode = mesh.material.wireframe
              ? WEBGL_CONSTANTS.LINE_STRIP
              : WEBGL_CONSTANTS.TRIANGLE_STRIP;
          } else {
            mode = mesh.material.wireframe
              ? WEBGL_CONSTANTS.LINES
              : WEBGL_CONSTANTS.TRIANGLES;
          }
        }

        let gltfMesh = {};

        let attributes = {};
        let primitives = [];
        let targets = [];

        // Conversion between attributes names in threejs and gltf
        // spec
        let nameConversion = {
          uv: 'TEXCOORD_0',
          uv2: 'TEXCOORD_1',
          color: 'COLOR_0',
          skinWeight: 'WEIGHTS_0',
          skinIndex: 'JOINTS_0',
        };

        let originalNormal = geometry.getAttribute('normal');

        if (
          originalNormal !== undefined &&
          !isNormalizedNormalAttribute(originalNormal)
        ) {
          console.warn(
            'THREE.GLTFExporter: Creating normalized normal attribute from the non-normalized one.',
          );

          geometry.addAttribute(
            'normal',
            createNormalizedNormalAttribute(originalNormal),
          );
        }

        // @QUESTION Detect if .vertexColors = THREE.VertexColors?
        // For every attribute create an accessor
        for (let attributeName in geometry.attributes) {
          let attribute = geometry.attributes[attributeName];
          attributeName =
            nameConversion[attributeName] || attributeName.toUpperCase();

          // JOINTS_0 must be UNSIGNED_BYTE or UNSIGNED_SHORT.
          let array = attribute.array;
          if (
            attributeName === 'JOINTS_0' &&
            !(array instanceof Uint16Array) &&
            !(array instanceof Uint8Array)
          ) {
            console.warn(
              'GLTFExporter: Attribute "skinIndex" converted to type UNSIGNED_SHORT.',
            );
            attribute = new THREE.BufferAttribute(
              new Uint16Array(array),
              attribute.itemSize,
              attribute.normalized,
            );
          }

          if (attributeName.substr(0, 5) !== 'MORPH') {
            let accessor = processAccessor(attribute, geometry);
            if (accessor !== null) {
              attributes[attributeName] = accessor;
            }
          }
        }

        if (originalNormal !== undefined)
          geometry.addAttribute('normal', originalNormal);

        // Skip if no exportable attributes found
        if (Object.keys(attributes).length === 0) {
          return null;
        }

        // Morph targets
        if (
          mesh.morphTargetInfluences !== undefined &&
          mesh.morphTargetInfluences.length > 0
        ) {
          let weights = [];
          let targetNames = [];
          let reverseDictionary = {};

          if (mesh.morphTargetDictionary !== undefined) {
            for (let key in mesh.morphTargetDictionary) {
              reverseDictionary[mesh.morphTargetDictionary[key]] = key;
            }
          }

          for (let i = 0; i < mesh.morphTargetInfluences.length; ++i) {
            let target = {};

            let warned = false;

            for (let attributeName in geometry.morphAttributes) {
              // glTF 2.0 morph supports only
              // POSITION/NORMAL/TANGENT.
              // Three.js doesn't support TANGENT yet.

              if (attributeName !== 'position' && attributeName !== 'normal') {
                if (!warned) {
                  console.warn(
                    'GLTFExporter: Only POSITION and NORMAL morph are supported.',
                  );
                  warned = true;
                }

                continue;
              }

              let attribute = geometry.morphAttributes[attributeName][i];

              // Three.js morph attribute has absolute values
              // while the one of glTF has relative values.
              //
              // glTF 2.0 Specification:
              // https://github.com/KhronosGroup/glTF/tree/master/specification/2.0#morph-targets

              let baseAttribute = geometry.attributes[attributeName];
              // Clones attribute not to override
              let relativeAttribute = attribute.clone();

              for (let j = 0, jl = attribute.count; j < jl; j++) {
                relativeAttribute.setXYZ(
                  j,
                  attribute.getX(j) - baseAttribute.getX(j),
                  attribute.getY(j) - baseAttribute.getY(j),
                  attribute.getZ(j) - baseAttribute.getZ(j),
                );
              }

              target[attributeName.toUpperCase()] = processAccessor(
                relativeAttribute,
                geometry,
              );
            }

            targets.push(target);

            weights.push(mesh.morphTargetInfluences[i]);
            if (mesh.morphTargetDictionary !== undefined)
              targetNames.push(reverseDictionary[i]);
          }

          gltfMesh.weights = weights;

          if (targetNames.length > 0) {
            gltfMesh.extras = {};
            gltfMesh.extras.targetNames = targetNames;
          }
        }

        let extras =
          Object.keys(geometry.userData).length > 0
            ? serializeUserData(geometry)
            : undefined;

        let forceIndices = options.forceIndices;
        let isMultiMaterial = Array.isArray(mesh.material);

        if (isMultiMaterial && geometry.groups.length === 0) return null;

        if (!forceIndices && geometry.index === null && isMultiMaterial) {
          // temporal workaround.
          console.warn(
            'THREE.GLTFExporter: Creating index for non-indexed multi-material mesh.',
          );
          forceIndices = true;
        }

        let didForceIndices = false;

        if (geometry.index === null && forceIndices) {
          let indices = [];

          for (
            let i = 0, il = geometry.attributes.position.count;
            i < il;
            i++
          ) {
            indices[i] = i;
          }

          geometry.setIndex(indices);

          didForceIndices = true;
        }

        let materials = isMultiMaterial ? mesh.material : [mesh.material];
        let groups = isMultiMaterial
          ? geometry.groups
          : [{ materialIndex: 0, start: undefined, count: undefined }];

        for (let i = 0, il = groups.length; i < il; i++) {
          let primitive = {
            mode: mode,
            attributes: attributes,
          };

          if (extras) primitive.extras = extras;

          if (targets.length > 0) primitive.targets = targets;

          if (geometry.index !== null) {
            primitive.indices = processAccessor(
              geometry.index,
              geometry,
              groups[i].start,
              groups[i].count,
            );
          }

          let material = processMaterial(materials[groups[i].materialIndex]);

          if (material !== null) {
            primitive.material = material;
          }

          primitives.push(primitive);
        }

        if (didForceIndices) {
          geometry.setIndex(null);
        }

        gltfMesh.primitives = primitives;

        if (!outputJSON.meshes) {
          outputJSON.meshes = [];
        }

        outputJSON.meshes.push(gltfMesh);

        return outputJSON.meshes.length - 1;
      }

      /*
       * Process camera
       *
       * @param {THREE.Camera}
       *            camera Camera to process
       * @return {Integer} Index of the processed mesh in the "camera"
       *         array
       */
      function processCamera(camera) {
        if (!outputJSON.cameras) {
          outputJSON.cameras = [];
        }

        let isOrtho = camera.isOrthographicCamera;

        let gltfCamera = {
          type: isOrtho ? 'orthographic' : 'perspective',
        };

        if (isOrtho) {
          gltfCamera.orthographic = {
            xmag: camera.right * 2,
            ymag: camera.top * 2,
            zfar: camera.far <= 0 ? 0.001 : camera.far,
            znear: camera.near < 0 ? 0 : camera.near,
          };
        } else {
          gltfCamera.perspective = {
            aspectRatio: camera.aspect,
            yfov: THREE.Math.degToRad(camera.fov) / camera.aspect,
            zfar: camera.far <= 0 ? 0.001 : camera.far,
            znear: camera.near < 0 ? 0 : camera.near,
          };
        }

        if (camera.name !== '') {
          gltfCamera.name = camera.type;
        }

        outputJSON.cameras.push(gltfCamera);

        return outputJSON.cameras.length - 1;
      }

      /*
       * Creates glTF animation entry from AnimationClip object.
       *
       * Status: - Only properties listed in PATH_PROPERTIES may be
       * animated.
       *
       * @param {THREE.AnimationClip}
       *            clip
       * @param {THREE.Object3D}
       *            root
       * @return {number}
       */
      function processAnimation(clip, root) {
        if (!outputJSON.animations) {
          outputJSON.animations = [];
        }

        let channels = [];
        let samplers = [];

        for (let i = 0; i < clip.tracks.length; ++i) {
          let track = clip.tracks[i];
          let trackBinding = THREE.PropertyBinding.parseTrackName(track.name);
          let trackNode = THREE.PropertyBinding.findNode(
            root,
            trackBinding.nodeName,
          );
          let trackProperty = PATH_PROPERTIES[trackBinding.propertyName];

          if (trackBinding.objectName === 'bones') {
            if (trackNode.isSkinnedMesh === true) {
              trackNode = trackNode.skeleton.getBoneByName(
                trackBinding.objectIndex,
              );
            } else {
              trackNode = undefined;
            }
          }

          if (!trackNode || !trackProperty) {
            console.warn(
              'THREE.GLTFExporter: Could not export animation track "%s".',
              track.name,
            );
            return null;
          }

          let inputItemSize = 1;
          let outputItemSize = track.values.length / track.times.length;

          if (trackProperty === PATH_PROPERTIES.morphTargetInfluences) {
            if (
              trackNode.morphTargetInfluences.length !== 1 &&
              trackBinding.propertyIndex !== undefined
            ) {
              console.warn(
                'THREE.GLTFExporter: Skipping animation track "%s". ' +
                  'Morph target keyframe tracks must target all available morph targets ' +
                  'for the given mesh.',
                track.name,
              );
              continue;
            }

            outputItemSize /= trackNode.morphTargetInfluences.length;
          }

          let interpolation;

          // @TODO export CubicInterpolant(InterpolateSmooth) as
          // CUBICSPLINE

          // Detecting glTF cubic spline interpolant by checking
          // factory method's special property
          // GLTFCubicSplineInterpolant is a custom interpolant
          // and track doesn't return
          // valid value from .getInterpolation().
          if (
            track.createInterpolant
              .isInterpolantFactoryMethodGLTFCubicSpline === true
          ) {
            interpolation = 'CUBICSPLINE';

            // itemSize of CUBICSPLINE keyframe is 9
            // (VEC3 * 3: inTangent, splineVertex, and
            // outTangent)
            // but needs to be stored as VEC3 so dividing by 3
            // here.
            outputItemSize /= 3;
          } else if (track.getInterpolation() === THREE.InterpolateDiscrete) {
            interpolation = 'STEP';
          } else {
            interpolation = 'LINEAR';
          }

          samplers.push({
            input: processAccessor(
              new THREE.BufferAttribute(track.times, inputItemSize),
            ),
            output: processAccessor(
              new THREE.BufferAttribute(track.values, outputItemSize),
            ),
            interpolation: interpolation,
          });

          channels.push({
            sampler: samplers.length - 1,
            target: {
              node: nodeMap.get(trackNode),
              path: trackProperty,
            },
          });
        }

        outputJSON.animations.push({
          name: clip.name || 'clip_' + outputJSON.animations.length,
          samplers: samplers,
          channels: channels,
        });

        return outputJSON.animations.length - 1;
      }

      function processSkin(object) {
        let node = outputJSON.nodes[nodeMap.get(object)];

        let skeleton = object.skeleton;
        let rootJoint = object.skeleton.bones[0];

        if (rootJoint === undefined) return null;

        let joints = [];
        let inverseBindMatrices = new Float32Array(skeleton.bones.length * 16);

        for (let i = 0; i < skeleton.bones.length; ++i) {
          joints.push(nodeMap.get(skeleton.bones[i]));

          skeleton.boneInverses[i].toArray(inverseBindMatrices, i * 16);
        }

        if (outputJSON.skins === undefined) {
          outputJSON.skins = [];
        }

        outputJSON.skins.push({
          inverseBindMatrices: processAccessor(
            new THREE.BufferAttribute(inverseBindMatrices, 16),
          ),
          joints: joints,
          skeleton: nodeMap.get(rootJoint),
        });

        let skinIndex = (node.skin = outputJSON.skins.length - 1);

        return skinIndex;
      }

      /*
       * Process Object3D node
       *
       * @param {THREE.Object3D}
       *            node Object3D to processNode
       * @return {Integer} Index of the node in the nodes list
       */
      function processNode(object) {
        if (object.isLight) {
          console.warn(
            'GLTFExporter: Unsupported node type:',
            object.constructor.name,
          );
          return null;
        }

        if (!outputJSON.nodes) {
          outputJSON.nodes = [];
        }

        let gltfNode = {};

        if (options.trs) {
          let rotation = object.quaternion.toArray();
          let position = object.position.toArray();
          let scale = object.scale.toArray();

          if (!equalArray(rotation, [0, 0, 0, 1])) {
            gltfNode.rotation = rotation;
          }

          if (!equalArray(position, [0, 0, 0])) {
            gltfNode.translation = position;
          }

          if (!equalArray(scale, [1, 1, 1])) {
            gltfNode.scale = scale;
          }
        } else {
          object.updateMatrix();
          if (
            !equalArray(
              object.matrix.elements,
              [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
            )
          ) {
            gltfNode.matrix = object.matrix.elements;
          }
        }

        // We don't export empty strings name because it represents
        // no-name in Three.js.
        if (object.name !== '') {
          gltfNode.name = String(object.name);
        }

        if (object.userData && Object.keys(object.userData).length > 0) {
          gltfNode.extras = serializeUserData(object);
        }

        if (object.isMesh || object.isLine || object.isPoints) {
          let mesh = processMesh(object);

          if (mesh !== null) {
            gltfNode.mesh = mesh;
          }
        } else if (object.isCamera) {
          gltfNode.camera = processCamera(object);
        }

        if (object.isSkinnedMesh) {
          skins.push(object);
        }

        if (object.children.length > 0) {
          let children = [];

          for (let i = 0, l = object.children.length; i < l; i++) {
            let child = object.children[i];

            if (child.visible || options.onlyVisible === false) {
              let node = processNode(child);

              if (node !== null) {
                children.push(node);
              }
            }
          }

          if (children.length > 0) {
            gltfNode.children = children;
          }
        }

        outputJSON.nodes.push(gltfNode);

        let nodeIndex = outputJSON.nodes.length - 1;
        nodeMap.set(object, nodeIndex);

        return nodeIndex;
      }

      /*
       * Process Scene
       *
       * @param {THREE.Scene}
       *            node Scene to process
       */
      function processScene(scene) {
        if (!outputJSON.scenes) {
          outputJSON.scenes = [];
          outputJSON.scene = 0;
        }

        let gltfScene = {
          nodes: [],
        };

        if (scene.name !== '') {
          gltfScene.name = scene.name;
        }

        outputJSON.scenes.push(gltfScene);

        let nodes = [];

        for (let i = 0, l = scene.children.length; i < l; i++) {
          let child = scene.children[i];

          if (child.visible || options.onlyVisible === false) {
            let node = processNode(child);

            if (node !== null) {
              nodes.push(node);
            }
          }
        }

        if (nodes.length > 0) {
          gltfScene.nodes = nodes;
        }
      }

      /*
       * Creates a THREE.Scene to hold a list of objects and parse it
       *
       * @param {Array}
       *            objects List of objects to process
       */
      function processObjects(objects) {
        let scene = new THREE.Scene();
        scene.name = 'AuxScene';

        for (let i = 0; i < objects.length; i++) {
          // We push directly to children instead of calling `add`
          // to prevent
          // modify the .parent and break its original scene and
          // hierarchy
          scene.children.push(objects[i]);
        }

        processScene(scene);
      }

      function processInput(input) {
        input = input instanceof Array ? input : [input];

        let objectsWithoutScene = [];

        for (let i = 0; i < input.length; i++) {
          if (input[i] instanceof THREE.Scene) {
            processScene(input[i]);
          } else {
            objectsWithoutScene.push(input[i]);
          }
        }

        if (objectsWithoutScene.length > 0) {
          processObjects(objectsWithoutScene);
        }

        for (let i = 0; i < skins.length; ++i) {
          processSkin(skins[i]);
        }

        for (let i = 0; i < options.animations.length; ++i) {
          processAnimation(options.animations[i], input[0]);
        }
      }

      processInput(input);

      Promise.all(pending).then(function () {
        // Merge buffers.
        let blob = new Blob(buffers, { type: 'application/octet-stream' });

        // Declare extensions.
        let extensionsUsedList = Object.keys(extensionsUsed);
        if (extensionsUsedList.length > 0)
          outputJSON.extensionsUsed = extensionsUsedList;

        if (outputJSON.buffers && outputJSON.buffers.length > 0) {
          // Update bytelength of the single buffer.
          outputJSON.buffers[0].byteLength = blob.size;

          let reader = new window.FileReader();

          if (options.binary === true) {
            // https://github.com/KhronosGroup/glTF/blob/master/specification/2.0/README.md#glb-file-format-specification

            let GLB_HEADER_BYTES = 12;
            let GLB_HEADER_MAGIC = 0x46546c67;
            let GLB_VERSION = 2;

            let GLB_CHUNK_PREFIX_BYTES = 8;
            let GLB_CHUNK_TYPE_JSON = 0x4e4f534a;
            let GLB_CHUNK_TYPE_BIN = 0x004e4942;

            reader.readAsArrayBuffer(blob);
            reader.onloadend = function () {
              // Binary chunk.
              let binaryChunk = getPaddedArrayBuffer(reader.result);
              let binaryChunkPrefix = new DataView(
                new ArrayBuffer(GLB_CHUNK_PREFIX_BYTES),
              );
              binaryChunkPrefix.setUint32(0, binaryChunk.byteLength, true);
              binaryChunkPrefix.setUint32(4, GLB_CHUNK_TYPE_BIN, true);

              // JSON chunk.
              let jsonChunk = getPaddedArrayBuffer(
                stringToArrayBuffer(JSON.stringify(outputJSON)),
                0x20,
              );
              let jsonChunkPrefix = new DataView(
                new ArrayBuffer(GLB_CHUNK_PREFIX_BYTES),
              );
              jsonChunkPrefix.setUint32(0, jsonChunk.byteLength, true);
              jsonChunkPrefix.setUint32(4, GLB_CHUNK_TYPE_JSON, true);

              // GLB header.
              let header = new ArrayBuffer(GLB_HEADER_BYTES);
              let headerView = new DataView(header);
              headerView.setUint32(0, GLB_HEADER_MAGIC, true);
              headerView.setUint32(4, GLB_VERSION, true);
              let totalByteLength =
                GLB_HEADER_BYTES +
                jsonChunkPrefix.byteLength +
                jsonChunk.byteLength +
                binaryChunkPrefix.byteLength +
                binaryChunk.byteLength;
              headerView.setUint32(8, totalByteLength, true);

              let glbBlob = new Blob(
                [
                  header,
                  jsonChunkPrefix,
                  jsonChunk,
                  binaryChunkPrefix,
                  binaryChunk,
                ],
                { type: 'application/octet-stream' },
              );

              let glbReader = new window.FileReader();
              glbReader.readAsArrayBuffer(glbBlob);
              glbReader.onloadend = function () {
                onDone(glbReader.result);
              };
            };
          } else {
            reader.readAsDataURL(blob);
            reader.onloadend = function () {
              let base64data = reader.result;
              outputJSON.buffers[0].uri = base64data;
              onDone(outputJSON);
            };
          }
        } else {
          onDone(outputJSON);
        }
      });
    },
  };
  return GLTFExporter;
})();
module.exports = _GLTFExporter;
