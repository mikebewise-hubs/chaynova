/*
CLOUDFLAREME ROUTES FOR YOUR EXISTING CHAYNOVA WORKER

ACTUAL BINDINGS FROM YOUR CLOUDFLARE SCREENSHOT:
  env.DB
  env.PRODUCT_DB
  env.STORY_IMAGES
  env.PRODUCT_IMAGES
  env.PRODUCT_DOCUMENTS

ROUTES:
  GET    /cloudflareme
  DELETE /cloudflareme/file?bucket=story|product|documents&key=...
  POST   /cloudflareme/replace

IMPORTANT:
Replace verifyAdminRequest() with the same token check already used by your
protected story and product routes.
*/

export async function handleCloudflareMe(request, env) {
  const url = new URL(request.url);
  if (url.pathname !== "/cloudflareme" && !url.pathname.startsWith("/cloudflareme/")) return null;

  if (!(await verifyAdminRequest(request, env))) {
    return cors(request, json({success:false,error:"Unauthorized"},401));
  }

  try {
    if (request.method === "GET" && url.pathname === "/cloudflareme") {
      return cors(request, await getDashboard(request, env));
    }

    if (request.method === "DELETE" && url.pathname === "/cloudflareme/file") {
      return cors(request, await deleteFile(request, env, url));
    }

    if (request.method === "POST" && url.pathname === "/cloudflareme/replace") {
      return cors(request, await replaceFile(request, env));
    }

    return cors(request, json({success:false,error:"Unsupported route."},405));
  } catch (error) {
    console.error("CloudflareMe error:", error);
    return cors(request, json({success:false,error:error?.message || "CloudflareMe failed."},500));
  }
}

async function verifyAdminRequest(request, env) {
  // REQUIRED: replace this with your existing admin-token verifier.
  // Example:
  // return await isAuthorized(request, env);
  return false;
}

async function getDashboard(request, env) {
  assertBindings(env);

  const [storyObjects, productObjects, documentObjects, storyRefs, productImageRefs, documentRefs] =
    await Promise.all([
      listAll(env.STORY_IMAGES),
      listAll(env.PRODUCT_IMAGES),
      listAll(env.PRODUCT_DOCUMENTS),
      loadStoryReferences(env.DB),
      loadProductImageReferences(env.PRODUCT_DB),
      loadDocumentReferences(env.PRODUCT_DB)
    ]);

  const origin = new URL(request.url).origin;

  const storyFiles = mapBucketFiles(
    storyObjects, "story", "STORY_IMAGES", storyRefs,
    key => `${origin}/image/${encodeURIComponent(key)}`
  );

  const productFiles = mapBucketFiles(
    productObjects, "product", "PRODUCT_IMAGES", productImageRefs,
    key => `${origin}/products/images/${encodeURIComponent(key)}`
  );

  const documentFiles = mapBucketFiles(
    documentObjects, "documents", "PRODUCT_DOCUMENTS", documentRefs,
    key => `${origin}/products/documents/${encodeURIComponent(key)}`
  );

  const files = [...storyFiles, ...productFiles, ...documentFiles];

  const brokenReferences = [
    ...findBroken(storyRefs, storyObjects, "story", "STORY_IMAGES"),
    ...findBroken(productImageRefs, productObjects, "product", "PRODUCT_IMAGES"),
    ...findBroken(documentRefs, documentObjects, "documents", "PRODUCT_DOCUMENTS")
  ];

  return json({
    success: true,
    summary: {
      total_files: files.length,
      total_bytes: files.reduce((s,x)=>s+Number(x.size||0),0),
      attached: files.filter(x=>x.status==="attached").length,
      detached: files.filter(x=>x.status==="detached").length,
      broken: brokenReferences.length
    },
    files,
    broken_references: brokenReferences
  });
}

async function deleteFile(request, env, url) {
  const bucketType = url.searchParams.get("bucket");
  const key = url.searchParams.get("key");
  if (!key) return json({success:false,error:"Missing key."},400);

  const bucket = getBucket(env, bucketType);
  const refs = await referencesForType(env, bucketType);
  const attached = refs.filter(ref => matches(key, ref.media_value));

  if (attached.length) {
    return json({
      success:false,
      error:"This file is still attached. Replace it or remove the database reference first.",
      references:attached
    },409);
  }

  const exists = await bucket.head(key);
  if (!exists) return json({success:false,error:"File not found."},404);

  await bucket.delete(key);
  return json({success:true,deleted_key:key,bucket:bucketType});
}

async function replaceFile(request, env) {
  const form = await request.formData();
  const bucketType = String(form.get("bucket") || "");
  const key = String(form.get("key") || "");
  const image = form.get("image");

  if (!key) return json({success:false,error:"Missing key."},400);
  if (!(image instanceof File)) return json({success:false,error:"Missing image."},400);
  if (!image.type.startsWith("image/")) return json({success:false,error:"Choose an image file."},415);
  if (image.size > 12 * 1024 * 1024) return json({success:false,error:"Image exceeds 12 MB."},413);

  const bucket = getBucket(env, bucketType);
  const old = await bucket.head(key);
  if (!old) return json({success:false,error:"Original file not found."},404);

  const now = new Date().toISOString();

  await bucket.put(key, image.stream(), {
    httpMetadata: {
      contentType: image.type,
      cacheControl: "public, max-age=3600"
    },
    customMetadata: {
      uploaded_at: old.customMetadata?.uploaded_at || old.uploaded?.toISOString?.() || now,
      updated_at: now,
      original_filename: image.name || basename(key)
    }
  });

  return json({
    success:true,
    key,
    bucket:bucketType,
    size:image.size,
    content_type:image.type,
    updated_at:now
  });
}

function getBucket(env, type) {
  if (type === "story") return env.STORY_IMAGES;
  if (type === "product") return env.PRODUCT_IMAGES;
  if (type === "documents") return env.PRODUCT_DOCUMENTS;
  throw new Error("Unknown bucket type.");
}

async function referencesForType(env, type) {
  if (type === "story") return loadStoryReferences(env.DB);
  if (type === "product") return loadProductImageReferences(env.PRODUCT_DB);
  if (type === "documents") return loadDocumentReferences(env.PRODUCT_DB);
  throw new Error("Unknown bucket type.");
}

async function listAll(bucket) {
  const all = [];
  let cursor;
  do {
    const page = await bucket.list({
      cursor,
      limit: 1000,
      include: ["httpMetadata", "customMetadata"]
    });
    all.push(...page.objects);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return all;
}

function mapBucketFiles(objects, type, bucketName, refs, urlBuilder) {
  return objects.map(obj => {
    const linked = refs.filter(ref => matches(obj.key, ref.media_value));
    const owner = linked[0] || {};
    return {
      key: obj.key,
      filename: basename(obj.key),
      bucket: bucketName,
      bucket_type: type,
      owner_type: owner.owner_type || "",
      owner_id: owner.owner_id || "",
      owner_name: owner.owner_name || "",
      route: owner.route || obj.key,
      status: linked.length ? "attached" : "detached",
      attached: linked.length > 0,
      url: urlBuilder(obj.key),
      uploaded_at: obj.customMetadata?.uploaded_at || obj.uploaded?.toISOString?.() || null,
      updated_at: obj.customMetadata?.updated_at || obj.uploaded?.toISOString?.() || null,
      size: obj.size || 0,
      content_type: obj.httpMetadata?.contentType || "",
      etag: obj.httpEtag || obj.etag || ""
    };
  });
}

function findBroken(refs, objects, type, bucketName) {
  const keys = objects.map(x => normalize(x.key));
  return refs
    .filter(ref => !keys.some(key => matches(key, ref.media_value)))
    .map(ref => ({
      key: ref.media_value,
      filename: basename(ref.media_value),
      bucket: bucketName,
      bucket_type: type,
      owner_type: ref.owner_type,
      owner_id: ref.owner_id,
      owner_name: ref.owner_name,
      route: ref.route,
      status: "broken",
      attached: true,
      uploaded_at: null,
      size: 0,
      content_type: "",
      url: ""
    }));
}

async function loadStoryReferences(db) {
  const attempts = [
    `SELECT id AS owner_id, title AS owner_name, image AS media_value FROM stories WHERE image IS NOT NULL AND TRIM(image) <> ''`,
    `SELECT id AS owner_id, title AS owner_name, image_url AS media_value FROM stories WHERE image_url IS NOT NULL AND TRIM(image_url) <> ''`
  ];

  for (const sql of attempts) {
    try {
      const result = await db.prepare(sql).all();
      return (result.results || []).map(row => ({
        owner_type:"story",
        owner_id:String(row.owner_id ?? ""),
        owner_name:String(row.owner_name ?? ""),
        media_value:String(row.media_value ?? ""),
        route:`/fun.html?story=${encodeURIComponent(String(row.owner_id ?? ""))}`
      }));
    } catch (_) {}
  }

  return [];
}

async function loadProductImageReferences(db) {
  const attempts = [
    `SELECT pi.id AS image_id, pi.product_id AS owner_id, p.product_name AS owner_name,
            COALESCE(pi.image_key, pi.image_url, pi.filename) AS media_value
     FROM product_images pi LEFT JOIN products p ON p.id = pi.product_id`,
    `SELECT pi.id AS image_id, pi.product_id AS owner_id, p.name AS owner_name,
            COALESCE(pi.r2_key, pi.url, pi.filename) AS media_value
     FROM product_images pi LEFT JOIN products p ON p.id = pi.product_id`
  ];

  for (const sql of attempts) {
    try {
      const result = await db.prepare(sql).all();
      return (result.results || []).map(row => ({
        owner_type:"product",
        owner_id:String(row.owner_id ?? ""),
        owner_name:String(row.owner_name ?? ""),
        media_value:String(row.media_value ?? ""),
        route:`/shop.html?product=${encodeURIComponent(String(row.owner_id ?? ""))}`,
        image_id:String(row.image_id ?? "")
      }));
    } catch (_) {}
  }

  return [];
}

async function loadDocumentReferences(db) {
  const attempts = [
    `SELECT pd.id AS document_id, pd.product_id AS owner_id, p.product_name AS owner_name,
            COALESCE(pd.object_key, pd.document_url, pd.filename) AS media_value
     FROM product_documents pd LEFT JOIN products p ON p.id = pd.product_id`,
    `SELECT pd.id AS document_id, pd.product_id AS owner_id, p.name AS owner_name,
            COALESCE(pd.r2_key, pd.url, pd.filename) AS media_value
     FROM product_documents pd LEFT JOIN products p ON p.id = pd.product_id`
  ];

  for (const sql of attempts) {
    try {
      const result = await db.prepare(sql).all();
      return (result.results || []).map(row => ({
        owner_type:"product document",
        owner_id:String(row.owner_id ?? ""),
        owner_name:String(row.owner_name ?? ""),
        media_value:String(row.media_value ?? ""),
        route:`/products.html?id=${encodeURIComponent(String(row.owner_id ?? ""))}`,
        document_id:String(row.document_id ?? "")
      }));
    } catch (_) {}
  }

  return [];
}

function matches(a,b) {
  const x = normalize(a), y = normalize(b);
  if (!x || !y) return false;
  return x === y || basename(x) === basename(y);
}

function normalize(value) {
  if (!value) return "";
  let text = String(value).trim();
  try {
    const u = new URL(text);
    text = decodeURIComponent(u.pathname);
  } catch (_) {
    try { text = decodeURIComponent(text); } catch (_) {}
  }
  return text.replace(/^\/+/,"").replace(/^image\//,"").replace(/^images\//,"");
}

function basename(value) {
  return String(value || "").split("/").filter(Boolean).pop() || "";
}

function assertBindings(env) {
  const missing = [];
  if (!env.DB) missing.push("DB");
  if (!env.PRODUCT_DB) missing.push("PRODUCT_DB");
  if (!env.STORY_IMAGES) missing.push("STORY_IMAGES");
  if (!env.PRODUCT_IMAGES) missing.push("PRODUCT_IMAGES");
  if (!env.PRODUCT_DOCUMENTS) missing.push("PRODUCT_DOCUMENTS");
  if (missing.length) throw new Error(`Missing bindings: ${missing.join(", ")}`);
}

function json(data,status=200) {
  return new Response(JSON.stringify(data,null,2),{
    status,
    headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}
  });
}

function cors(request,response) {
  const h = new Headers(response.headers);
  h.set("Access-Control-Allow-Origin",request.headers.get("Origin") || "*");
  h.set("Access-Control-Allow-Headers","Authorization, Content-Type");
  h.set("Access-Control-Allow-Methods","GET, POST, DELETE, OPTIONS");
  h.set("Vary","Origin");
  return new Response(response.body,{status:response.status,statusText:response.statusText,headers:h});
}

/*
MAIN WORKER INTEGRATION

At the top of your main Worker file:

import { handleCloudflareMe } from "./cloudflareme-worker-routes.js";

Inside fetch(), before your final 404:

const cloudflareMeResponse = await handleCloudflareMe(request, env);
if (cloudflareMeResponse) return cloudflareMeResponse;

Also keep or add OPTIONS handling:

if (request.method === "OPTIONS") {
  return new Response(null,{
    status:204,
    headers:{
      "Access-Control-Allow-Origin":request.headers.get("Origin") || "*",
      "Access-Control-Allow-Headers":"Authorization, Content-Type",
      "Access-Control-Allow-Methods":"GET, POST, DELETE, OPTIONS",
      "Access-Control-Max-Age":"86400"
    }
  });
}
*/
