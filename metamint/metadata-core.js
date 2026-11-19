(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.MetadataCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const UTF8 = new TextEncoder();
  const UTF8_DECODER = new TextDecoder("utf-8", { fatal: false });
  const LATIN1_DECODER = new TextDecoder("latin1", { fatal: false });
  const XMP_HEADER = "http://ns.adobe.com/xap/1.0/\0";
  const XMP_EXTENDED_HEADER = "http://ns.adobe.com/xmp/extension/\0";
  const PHOTOSHOP_HEADER = "Photoshop 3.0\0";
  const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

  function concatBytes() {
    const parts = Array.from(arguments).filter(Boolean);
    const length = parts.reduce((sum, part) => sum + part.length, 0);
    const output = new Uint8Array(length);
    let offset = 0;
    for (const part of parts) {
      output.set(part, offset);
      offset += part.length;
    }
    return output;
  }

  function asciiBytes(value) {
    const output = new Uint8Array(value.length);
    for (let index = 0; index < value.length; index += 1) {
      output[index] = value.charCodeAt(index) & 0xff;
    }
    return output;
  }

  function asciiText(bytes) {
    let output = "";
    for (let index = 0; index < bytes.length; index += 1) {
      output += String.fromCharCode(bytes[index]);
    }
    return output;
  }

  function bytesStartWith(bytes, value) {
    const prefix = typeof value === "string" ? asciiBytes(value) : value;
    if (bytes.length < prefix.length) return false;
    for (let index = 0; index < prefix.length; index += 1) {
      if (bytes[index] !== prefix[index]) return false;
    }
    return true;
  }

  function equalBytes(left, right) {
    if (left.length !== right.length) return false;
    for (let index = 0; index < left.length; index += 1) {
      if (left[index] !== right[index]) return false;
    }
    return true;
  }

  function readUint16(bytes, offset) {
    return bytes[offset] * 256 + bytes[offset + 1];
  }

  function readUint32(bytes, offset) {
    return (
      bytes[offset] * 0x1000000 +
      (bytes[offset + 1] << 16) +
      (bytes[offset + 2] << 8) +
      bytes[offset + 3]
    ) >>> 0;
  }

  function uint16(value) {
    return new Uint8Array([(value >>> 8) & 0xff, value & 0xff]);
  }

  function uint32(value) {
    return new Uint8Array([
      (value >>> 24) & 0xff,
      (value >>> 16) & 0xff,
      (value >>> 8) & 0xff,
      value & 0xff,
    ]);
  }

  function normalizeKeywords(values) {
    const source = Array.isArray(values) ? values : String(values || "").split(/[,;\n]/);
    const seen = new Set();
    const output = [];

    for (const rawValue of source) {
      const value = String(rawValue || "").trim().replace(/\s+/g, " ");
      const key = value.toLocaleLowerCase();
      if (!value || seen.has(key)) continue;
      seen.add(key);
      output.push(value);
    }

    return output;
  }

  function mergeKeywords() {
    const combined = [];
    for (const values of arguments) combined.push.apply(combined, values || []);
    return normalizeKeywords(combined);
  }

  function xmlEscape(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }

  function xmlUnescape(value) {
    return String(value || "")
      .replace(/<[^>]*>/g, "")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&#(\d+);/g, function (_, code) {
        return String.fromCodePoint(Number(code));
      })
      .replace(/&#x([0-9a-f]+);/gi, function (_, code) {
        return String.fromCodePoint(parseInt(code, 16));
      })
      .replace(/&amp;/g, "&")
      .trim();
  }

  function firstMatch(value, pattern) {
    const match = String(value || "").match(pattern);
    return match ? xmlUnescape(match[1]) : "";
  }

  function extractXmpMetadata(xml) {
    const metadata = {
      keywords: [],
      title: "",
      description: "",
      creator: "",
      copyright: "",
    };
    if (!xml) return metadata;

    const subject = String(xml).match(/<(?:\w+:)?subject\b[^>]*>([\s\S]*?)<\/(?:\w+:)?subject>/i);
    if (subject) {
      const itemPattern = /<(?:\w+:)?li\b[^>]*>([\s\S]*?)<\/(?:\w+:)?li>/gi;
      let item;
      while ((item = itemPattern.exec(subject[1]))) {
        metadata.keywords.push(xmlUnescape(item[1]));
      }
    }

    metadata.keywords = normalizeKeywords(metadata.keywords);
    metadata.title = firstMatch(
      xml,
      /<(?:\w+:)?title\b[^>]*>[\s\S]*?<(?:\w+:)?li\b[^>]*>([\s\S]*?)<\/(?:\w+:)?li>[\s\S]*?<\/(?:\w+:)?title>/i,
    );
    metadata.description = firstMatch(
      xml,
      /<(?:\w+:)?description\b[^>]*>[\s\S]*?<(?:\w+:)?li\b[^>]*>([\s\S]*?)<\/(?:\w+:)?li>[\s\S]*?<\/(?:\w+:)?description>/i,
    );
    metadata.creator = firstMatch(
      xml,
      /<(?:\w+:)?creator\b[^>]*>[\s\S]*?<(?:\w+:)?li\b[^>]*>([\s\S]*?)<\/(?:\w+:)?li>[\s\S]*?<\/(?:\w+:)?creator>/i,
    );
    metadata.copyright = firstMatch(
      xml,
      /<(?:\w+:)?rights\b[^>]*>[\s\S]*?<(?:\w+:)?li\b[^>]*>([\s\S]*?)<\/(?:\w+:)?li>[\s\S]*?<\/(?:\w+:)?rights>/i,
    );
    return metadata;
  }

  function buildXmp(metadata) {
    const keywords = normalizeKeywords(metadata.keywords || []);
    const keywordItems = keywords.map((keyword) => `          <rdf:li>${xmlEscape(keyword)}</rdf:li>`).join("\n");
    const optional = [];

    if (metadata.title) {
      optional.push(
        `      <dc:title><rdf:Alt><rdf:li xml:lang="x-default">${xmlEscape(metadata.title)}</rdf:li></rdf:Alt></dc:title>`,
      );
    }
    if (metadata.description) {
      optional.push(
        `      <dc:description><rdf:Alt><rdf:li xml:lang="x-default">${xmlEscape(metadata.description)}</rdf:li></rdf:Alt></dc:description>`,
      );
    }
    if (metadata.creator) {
      optional.push(
        `      <dc:creator><rdf:Seq><rdf:li>${xmlEscape(metadata.creator)}</rdf:li></rdf:Seq></dc:creator>`,
      );
    }
    if (metadata.copyright) {
      optional.push(
        `      <dc:rights><rdf:Alt><rdf:li xml:lang="x-default">${xmlEscape(metadata.copyright)}</rdf:li></rdf:Alt></dc:rights>`,
      );
    }

    return `<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="MetaMint 1.0">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about=""
      xmlns:dc="http://purl.org/dc/elements/1.1/"
      xmlns:xmp="http://ns.adobe.com/xap/1.0/">
      <dc:subject>
        <rdf:Bag>
${keywordItems}
        </rdf:Bag>
      </dc:subject>
${optional.join("\n")}
      <xmp:CreatorTool>MetaMint</xmp:CreatorTool>
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
  }

  function parseJpeg(bytes) {
    if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
      throw new Error("هاد الملف ماشي صورة JPG صالحة.");
    }

    const segments = [];
    let position = 2;
    let tailStart = bytes.length;

    while (position < bytes.length) {
      const markerStart = position;
      if (bytes[position] !== 0xff) {
        throw new Error("بنية JPG غير صالحة أو الصورة معطوبة.");
      }
      while (position < bytes.length && bytes[position] === 0xff) position += 1;
      if (position >= bytes.length) break;

      const marker = bytes[position];
      position += 1;

      if (marker === 0xda || marker === 0xd9) {
        tailStart = markerStart;
        break;
      }

      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        segments.push({ marker, raw: bytes.slice(markerStart, position), payload: new Uint8Array() });
        continue;
      }

      if (position + 2 > bytes.length) throw new Error("بنية JPG ناقصة.");
      const length = readUint16(bytes, position);
      if (length < 2 || position + length > bytes.length) throw new Error("بنية JPG غير صالحة.");

      const segmentEnd = position + length;
      segments.push({
        marker,
        raw: bytes.slice(markerStart, segmentEnd),
        payload: bytes.slice(position + 2, segmentEnd),
      });
      position = segmentEnd;
    }

    return { segments, tail: bytes.slice(tailStart) };
  }

  function makeJpegSegment(marker, payload) {
    if (payload.length > 65533) throw new Error("الـmetadata كبيرة بزاف بالنسبة لملف JPG.");
    return concatBytes(new Uint8Array([0xff, marker]), uint16(payload.length + 2), payload);
  }

  function parsePhotoshopResources(payload) {
    if (!bytesStartWith(payload, PHOTOSHOP_HEADER)) return null;
    const resources = [];
    let position = PHOTOSHOP_HEADER.length;

    while (position < payload.length) {
      if (position + 10 > payload.length || asciiText(payload.slice(position, position + 4)) !== "8BIM") {
        return null;
      }
      position += 4;
      const id = readUint16(payload, position);
      position += 2;

      const nameLength = payload[position];
      const nameStart = position + 1;
      const nameEnd = nameStart + nameLength;
      if (nameEnd > payload.length) return null;
      const name = payload.slice(nameStart, nameEnd);
      position += 1 + nameLength;
      if ((1 + nameLength) % 2 === 1) position += 1;

      if (position + 4 > payload.length) return null;
      const size = readUint32(payload, position);
      position += 4;
      if (position + size > payload.length) return null;
      const data = payload.slice(position, position + size);
      position += size;
      if (size % 2 === 1) position += 1;

      resources.push({ id, name, data });
    }

    return resources;
  }

  function buildPhotoshopResources(resources) {
    const parts = [asciiBytes(PHOTOSHOP_HEADER)];
    for (const resource of resources) {
      const safeName = resource.name && resource.name.length <= 255 ? resource.name : new Uint8Array();
      const nameLength = new Uint8Array([safeName.length]);
      const namePadding = (1 + safeName.length) % 2 === 1 ? new Uint8Array([0]) : new Uint8Array();
      const dataPadding = resource.data.length % 2 === 1 ? new Uint8Array([0]) : new Uint8Array();
      parts.push(
        asciiBytes("8BIM"),
        uint16(resource.id),
        nameLength,
        safeName,
        namePadding,
        uint32(resource.data.length),
        resource.data,
        dataPadding,
      );
    }
    return concatBytes.apply(null, parts);
  }

  function parseIptc(data) {
    const datasets = [];
    let position = 0;

    while (position + 5 <= data.length) {
      if (data[position] !== 0x1c) {
        position += 1;
        continue;
      }
      const record = data[position + 1];
      const dataset = data[position + 2];
      const lengthWord = readUint16(data, position + 3);
      let valueLength = lengthWord;
      let valueStart = position + 5;

      if (lengthWord & 0x8000) {
        const lengthBytes = lengthWord & 0x7fff;
        if (lengthBytes < 1 || lengthBytes > 4 || valueStart + lengthBytes > data.length) break;
        valueLength = 0;
        for (let index = 0; index < lengthBytes; index += 1) {
          valueLength = valueLength * 256 + data[valueStart + index];
        }
        valueStart += lengthBytes;
      }

      if (valueStart + valueLength > data.length) break;
      datasets.push({ record, dataset, data: data.slice(valueStart, valueStart + valueLength) });
      position = valueStart + valueLength;
    }

    return datasets;
  }

  function buildIptcDataset(record, dataset, data) {
    if (data.length <= 0x7fff) {
      return concatBytes(new Uint8Array([0x1c, record, dataset]), uint16(data.length), data);
    }
    return concatBytes(
      new Uint8Array([0x1c, record, dataset, 0x80, 0x04]),
      uint32(data.length),
      data,
    );
  }

  function decodeIptcText(data) {
    const utf8 = UTF8_DECODER.decode(data).replace(/\0/g, "").trim();
    if (!utf8.includes("�")) return utf8;
    return LATIN1_DECODER.decode(data).replace(/\0/g, "").trim();
  }

  function extractIptcMetadata(datasets) {
    const metadata = {
      keywords: [],
      title: "",
      description: "",
      creator: "",
      copyright: "",
    };

    for (const item of datasets) {
      if (item.record !== 2) continue;
      const value = decodeIptcText(item.data);
      if (item.dataset === 25) metadata.keywords.push(value);
      if (item.dataset === 105 && !metadata.title) metadata.title = value;
      if (item.dataset === 120 && !metadata.description) metadata.description = value;
      if (item.dataset === 80 && !metadata.creator) metadata.creator = value;
      if (item.dataset === 116 && !metadata.copyright) metadata.copyright = value;
    }
    metadata.keywords = normalizeKeywords(metadata.keywords);
    return metadata;
  }

  function replaceIptcField(datasets, record, dataset, value) {
    const filtered = datasets.filter((item) => !(item.record === record && item.dataset === dataset));
    if (String(value || "").trim()) {
      filtered.push({ record, dataset, data: UTF8.encode(String(value).trim()) });
    }
    return filtered;
  }

  function buildIptc(existingDatasets, metadata) {
    let datasets = existingDatasets.filter(
      (item) => !(item.record === 1 && item.dataset === 90) && !(item.record === 2 && item.dataset === 25),
    );
    datasets.unshift({ record: 1, dataset: 90, data: new Uint8Array([0x1b, 0x25, 0x47]) });

    if (metadata.title !== undefined) datasets = replaceIptcField(datasets, 2, 105, metadata.title);
    if (metadata.description !== undefined) datasets = replaceIptcField(datasets, 2, 120, metadata.description);
    if (metadata.creator !== undefined) datasets = replaceIptcField(datasets, 2, 80, metadata.creator);
    if (metadata.copyright !== undefined) datasets = replaceIptcField(datasets, 2, 116, metadata.copyright);

    for (const keyword of normalizeKeywords(metadata.keywords)) {
      datasets.push({ record: 2, dataset: 25, data: UTF8.encode(keyword) });
    }

    return concatBytes.apply(
      null,
      datasets.map((item) => buildIptcDataset(item.record, item.dataset, item.data)),
    );
  }

  function blankMetadata() {
    return { keywords: [], title: "", description: "", creator: "", copyright: "" };
  }

  function combineMetadata(primary, secondary) {
    return {
      keywords: mergeKeywords(primary.keywords, secondary.keywords),
      title: primary.title || secondary.title || "",
      description: primary.description || secondary.description || "",
      creator: primary.creator || secondary.creator || "",
      copyright: primary.copyright || secondary.copyright || "",
    };
  }

  function inspectJpeg(bytes) {
    const parsed = parseJpeg(bytes);
    let metadata = blankMetadata();
    const datasets = [];
    let xmp = "";

    for (const segment of parsed.segments) {
      if (segment.marker === 0xe1 && bytesStartWith(segment.payload, XMP_HEADER)) {
        xmp = UTF8_DECODER.decode(segment.payload.slice(XMP_HEADER.length));
        metadata = combineMetadata(metadata, extractXmpMetadata(xmp));
      }
      if (segment.marker === 0xed) {
        const resources = parsePhotoshopResources(segment.payload);
        if (!resources) continue;
        for (const resource of resources) {
          if (resource.id === 0x0404) datasets.push.apply(datasets, parseIptc(resource.data));
        }
      }
    }

    metadata = combineMetadata(metadata, extractIptcMetadata(datasets));
    return { type: "jpeg", metadata, parsed, datasets, xmp };
  }

  function resolveMetadata(existing, requested) {
    const mergeExisting = requested.mergeExisting !== false;
    const keywords = mergeExisting
      ? mergeKeywords(existing.keywords, requested.keywords)
      : normalizeKeywords(requested.keywords);
    return {
      keywords,
      title: String(requested.title || "").trim() || existing.title || "",
      description: String(requested.description || "").trim() || existing.description || "",
      creator: String(requested.creator || "").trim() || existing.creator || "",
      copyright: String(requested.copyright || "").trim() || existing.copyright || "",
    };
  }

  function writeJpeg(bytes, requested) {
    const inspection = inspectJpeg(bytes);
    const finalMetadata = resolveMetadata(inspection.metadata, requested);
    const keptSegments = [];
    const photoshopResources = [];
    const iptcDatasets = [];

    for (const segment of inspection.parsed.segments) {
      const isXmp =
        segment.marker === 0xe1 &&
        (bytesStartWith(segment.payload, XMP_HEADER) || bytesStartWith(segment.payload, XMP_EXTENDED_HEADER));
      if (isXmp) continue;

      if (segment.marker === 0xed) {
        const resources = parsePhotoshopResources(segment.payload);
        if (resources) {
          for (const resource of resources) {
            if (resource.id === 0x0404) iptcDatasets.push.apply(iptcDatasets, parseIptc(resource.data));
            else photoshopResources.push(resource);
          }
          continue;
        }
      }
      keptSegments.push(segment);
    }

    const xmpPayload = concatBytes(asciiBytes(XMP_HEADER), UTF8.encode(buildXmp(finalMetadata)));
    const iptcData = buildIptc(iptcDatasets, finalMetadata);
    photoshopResources.push({ id: 0x0404, name: new Uint8Array(), data: iptcData });
    const photoshopPayload = buildPhotoshopResources(photoshopResources);
    const newSegments = [makeJpegSegment(0xe1, xmpPayload), makeJpegSegment(0xed, photoshopPayload)];

    let insertionIndex = 0;
    while (
      insertionIndex < keptSegments.length &&
      keptSegments[insertionIndex].marker >= 0xe0 &&
      keptSegments[insertionIndex].marker <= 0xef
    ) {
      insertionIndex += 1;
    }

    const rebuiltSegments = keptSegments.map((segment) => segment.raw);
    rebuiltSegments.splice.apply(rebuiltSegments, [insertionIndex, 0].concat(newSegments));
    const output = concatBytes(
      new Uint8Array([0xff, 0xd8]),
      concatBytes.apply(null, rebuiltSegments),
      inspection.parsed.tail,
    );
    return { bytes: output, type: "jpeg", metadata: finalMetadata };
  }

  function parsePng(bytes) {
    if (bytes.length < 20 || !equalBytes(bytes.slice(0, 8), PNG_SIGNATURE)) {
      throw new Error("هاد الملف ماشي صورة PNG صالحة.");
    }
    const chunks = [];
    let position = 8;

    while (position + 12 <= bytes.length) {
      const start = position;
      const length = readUint32(bytes, position);
      const type = asciiText(bytes.slice(position + 4, position + 8));
      const dataStart = position + 8;
      const end = dataStart + length + 4;
      if (end > bytes.length) throw new Error("بنية PNG غير صالحة أو الصورة معطوبة.");
      chunks.push({ type, data: bytes.slice(dataStart, dataStart + length), raw: bytes.slice(start, end) });
      position = end;
      if (type === "IEND") break;
    }
    if (!chunks.some((chunk) => chunk.type === "IEND")) throw new Error("ملف PNG ناقص.");
    return chunks;
  }

  function parseInternationalText(data) {
    const firstNull = data.indexOf(0);
    if (firstNull < 0 || firstNull + 5 > data.length) return null;
    const keyword = asciiText(data.slice(0, firstNull));
    const compressionFlag = data[firstNull + 1];
    let position = firstNull + 3;
    const languageEnd = data.indexOf(0, position);
    if (languageEnd < 0) return null;
    position = languageEnd + 1;
    const translatedEnd = data.indexOf(0, position);
    if (translatedEnd < 0) return null;
    position = translatedEnd + 1;
    if (compressionFlag !== 0) return { keyword, text: "", compressed: true };
    return { keyword, text: UTF8_DECODER.decode(data.slice(position)), compressed: false };
  }

  function makeInternationalText(keyword, text) {
    return concatBytes(
      asciiBytes(keyword),
      new Uint8Array([0, 0, 0, 0, 0]),
      UTF8.encode(String(text || "")),
    );
  }

  let crcTable = null;
  function getCrcTable() {
    if (crcTable) return crcTable;
    crcTable = new Uint32Array(256);
    for (let index = 0; index < 256; index += 1) {
      let value = index;
      for (let bit = 0; bit < 8; bit += 1) {
        value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
      }
      crcTable[index] = value >>> 0;
    }
    return crcTable;
  }

  function crc32(bytes) {
    const table = getCrcTable();
    let value = 0xffffffff;
    for (let index = 0; index < bytes.length; index += 1) {
      value = table[(value ^ bytes[index]) & 0xff] ^ (value >>> 8);
    }
    return (value ^ 0xffffffff) >>> 0;
  }

  function makePngChunk(type, data) {
    const typeBytes = asciiBytes(type);
    return concatBytes(uint32(data.length), typeBytes, data, uint32(crc32(concatBytes(typeBytes, data))));
  }

  function inspectPng(bytes) {
    const chunks = parsePng(bytes);
    let metadata = blankMetadata();

    for (const chunk of chunks) {
      if (chunk.type !== "iTXt") continue;
      const item = parseInternationalText(chunk.data);
      if (!item || item.compressed) continue;
      const key = item.keyword.toLowerCase();
      if (key === "xml:com.adobe.xmp") metadata = combineMetadata(metadata, extractXmpMetadata(item.text));
      if (key === "keywords" || key === "subject") {
        metadata.keywords = mergeKeywords(metadata.keywords, item.text.split(/[,;\n]/));
      }
      if (key === "title" && !metadata.title) metadata.title = item.text.trim();
      if (key === "description" && !metadata.description) metadata.description = item.text.trim();
      if (key === "author" && !metadata.creator) metadata.creator = item.text.trim();
      if (key === "copyright" && !metadata.copyright) metadata.copyright = item.text.trim();
    }

    return { type: "png", metadata, chunks };
  }

  function writePng(bytes, requested) {
    const inspection = inspectPng(bytes);
    const finalMetadata = resolveMetadata(inspection.metadata, requested);
    const replacedKeys = new Set([
      "xml:com.adobe.xmp",
      "keywords",
      "subject",
      "title",
      "description",
      "author",
      "copyright",
    ]);
    const kept = [];

    for (const chunk of inspection.chunks) {
      if (chunk.type === "iTXt") {
        const item = parseInternationalText(chunk.data);
        if (item && replacedKeys.has(item.keyword.toLowerCase())) continue;
      }
      if (chunk.type === "tEXt") {
        const nullIndex = chunk.data.indexOf(0);
        const keyword = nullIndex >= 0 ? asciiText(chunk.data.slice(0, nullIndex)).toLowerCase() : "";
        if (replacedKeys.has(keyword)) continue;
      }
      kept.push(chunk);
    }

    const additions = [
      makePngChunk("iTXt", makeInternationalText("XML:com.adobe.xmp", buildXmp(finalMetadata))),
      makePngChunk("iTXt", makeInternationalText("Keywords", finalMetadata.keywords.join(", "))),
    ];
    if (finalMetadata.title) additions.push(makePngChunk("iTXt", makeInternationalText("Title", finalMetadata.title)));
    if (finalMetadata.description) {
      additions.push(makePngChunk("iTXt", makeInternationalText("Description", finalMetadata.description)));
    }
    if (finalMetadata.creator) {
      additions.push(makePngChunk("iTXt", makeInternationalText("Author", finalMetadata.creator)));
    }
    if (finalMetadata.copyright) {
      additions.push(makePngChunk("iTXt", makeInternationalText("Copyright", finalMetadata.copyright)));
    }

    const outputChunks = [];
    for (const chunk of kept) {
      if (chunk.type === "IEND") outputChunks.push.apply(outputChunks, additions);
      outputChunks.push(chunk.raw);
    }
    return {
      bytes: concatBytes(PNG_SIGNATURE, concatBytes.apply(null, outputChunks)),
      type: "png",
      metadata: finalMetadata,
    };
  }

  function detectType(bytes) {
    if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8) return "jpeg";
    if (bytes.length >= 8 && equalBytes(bytes.slice(0, 8), PNG_SIGNATURE)) return "png";
    return "unknown";
  }

  function inspect(bytes) {
    const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const type = detectType(data);
    if (type === "jpeg") return inspectJpeg(data);
    if (type === "png") return inspectPng(data);
    throw new Error("حالياً البرنامج كيدعم غير JPG وPNG.");
  }

  function write(bytes, metadata) {
    const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const type = detectType(data);
    if (type === "jpeg") return writeJpeg(data, metadata || {});
    if (type === "png") return writePng(data, metadata || {});
    throw new Error("حالياً البرنامج كيدعم غير JPG وPNG.");
  }

  function taggedFileName(name) {
    const match = String(name || "image").match(/^(.*?)(\.[^.]+)?$/);
    const base = (match && match[1]) || "image";
    const extension = (match && match[2]) || "";
    return `${base}-tagged${extension}`;
  }

  return {
    inspect,
    write,
    detectType,
    normalizeKeywords,
    taggedFileName,
    _internals: {
      parseJpeg,
      parsePng,
      extractXmpMetadata,
      buildXmp,
      parseIptc,
      crc32,
    },
  };
});
