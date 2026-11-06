#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import https from 'https';

const token = process.env.VERCEL_TOKEN;
if (!token) throw new Error('VERCEL_TOKEN is required for deployment.');
const projectId = 'prj_6mOobCtAH8y1rGAhPUkVEgrmW4tk';
const projectName = 'melonpan-kosen';

function uploadFile(data, destPath) {
  return new Promise((resolve, reject) => {
    const sha = crypto.createHash('sha1').update(data).digest('hex');
    const req = https.request(
      {
        hostname: 'api.vercel.com',
        path: '/v2/files',
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + token,
          'Content-Length': data.length,
          'x-vercel-digest': sha,
        },
      },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({ file: destPath, sha, size: data.length });
          } else {
            reject(new Error(`Upload failed (${destPath}): ${res.statusCode} ${body}`));
          }
        });
      }
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function createDeployment(uploadedFiles) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      name: projectName,
      project: projectId,
      target: 'production',
      files: uploadedFiles,
    });

    const req = https.request(
      {
        hostname: 'api.vercel.com',
        path: '/v13/deployments?skipAutoDetectionConfirmation=1',
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + token,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
      },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          try {
            const json = JSON.parse(body);
            if (res.statusCode >= 200 && res.statusCode < 300) {
              resolve(json);
            } else {
              reject(new Error(`Deploy failed: ${res.statusCode} ${JSON.stringify(json)}`));
            }
          } catch (e) {
            reject(new Error('Parse error: ' + body));
          }
        });
      }
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function main() {
  const distDir = path.resolve('apps/web/dist');
  if (!fs.existsSync(distDir)) {
    throw new Error('apps/web/dist does not exist. Run "pnpm build" first.');
  }

  const filesToUpload = [];
  function collectFiles(dir, relPrefix = '') {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      const rel = relPrefix ? `${relPrefix}/${ent.name}` : ent.name;
      if (ent.isDirectory()) {
        collectFiles(full, rel);
      } else {
        filesToUpload.push({ full, rel });
      }
    }
  }

  collectFiles(distDir);
  console.log(`Found ${filesToUpload.length} files in apps/web/dist.`);

  const uploaded = [];
  for (const f of filesToUpload) {
    const data = fs.readFileSync(f.full);
    const res = await uploadFile(data, f.rel);
    uploaded.push(res);
  }

  const vercelJsonData = Buffer.from(
    JSON.stringify(
      {
        rewrites: [{ source: '/(.*)', destination: '/index.html' }],
      },
      null,
      2
    )
  );
  uploaded.push(await uploadFile(vercelJsonData, 'vercel.json'));

  console.log('Triggering production deployment to noimzip on Vercel...');
  const deployment = await createDeployment(uploaded);
  console.log('✓ Deployment created successfully!');
  console.log('  Deployment ID:', deployment.id);
  console.log('  Preview URL:  ', `https://${deployment.url}`);
  console.log('  Production:   ', 'https://melonpan-kosen.vercel.app');
}

main().catch((err) => {
  console.error('Deployment error:', err.message);
  process.exit(1);
});
