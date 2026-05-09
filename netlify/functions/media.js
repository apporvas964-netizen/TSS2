const https = require('https');

const CLOUD = process.env.CLOUDINARY_CLOUD_NAME;
const KEY = process.env.CLOUDINARY_API_KEY;
const SECRET = process.env.CLOUDINARY_API_SECRET;
const FOLDER = 'tss';

// Simple basic-auth header for Cloudinary REST API
const authHeader = 'Basic ' + Buffer.from(`${KEY}:${SECRET}`).toString('base64');

function httpsRequest(url, options = {}, body = null) {
    return new Promise((resolve, reject) => {
        const req = https.request(url, options, res => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
                catch { resolve({ status: res.statusCode, body: data }); }
            });
        });
        req.on('error', reject);
        if (body) req.write(body);
        req.end();
    });
}

exports.handler = async (event) => {
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Content-Type': 'application/json'
    };

    // CORS preflight
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    }

    const action = event.queryStringParameters?.action || 'list';

    try {
        // ── LIST all media in tss folder ──
        if (event.httpMethod === 'GET' && action === 'list') {
            // Fetch images from folder
            const imgUrl = `https://api.cloudinary.com/v1_1/${CLOUD}/resources/image?type=upload&prefix=${FOLDER}/&max_results=200`;
            const imgR = await httpsRequest(imgUrl, {
                method: 'GET',
                headers: { 'Authorization': authHeader }
            });
            const images = (imgR.body.resources || []).map(res => ({
                public_id: res.public_id,
                url: res.secure_url,
                type: 'image',
                created_at: res.created_at
            }));

            // Fetch videos from folder
            const vidUrl = `https://api.cloudinary.com/v1_1/${CLOUD}/resources/video?type=upload&prefix=${FOLDER}/&max_results=200`;
            const vidR = await httpsRequest(vidUrl, {
                method: 'GET',
                headers: { 'Authorization': authHeader }
            });
            const videos = (vidR.body.resources || []).map(res => ({
                public_id: res.public_id,
                url: res.secure_url,
                type: 'video',
                created_at: res.created_at
            }));

            const resources = [...images, ...videos].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
            return { statusCode: 200, headers, body: JSON.stringify({ resources }) };
        }

        // ── UPLOAD (get signed upload params) ──
        if (event.httpMethod === 'POST' && action === 'sign') {
            const timestamp = Math.round(Date.now() / 1000);
            const crypto = require('crypto');
            // const params = `folder=${FOLDER}&timestamp=${timestamp}`;
            // const signature = crypto.createHash('sha1')
            //     .update(params + SECRET)
            //     .digest('hex');
            // return {
            //     statusCode: 200, headers,
            //     body: JSON.stringify({ timestamp, signature, api_key: KEY, cloud_name: CLOUD, folder: FOLDER })
            // };

            const body = JSON.parse(event.body || '{}');
            const context = body.context ? JSON.parse(body.context) : null;
            let params = `folder=${FOLDER}&timestamp=${timestamp}`;
            let contextStr = null;
            if (context) {
                contextStr = Object.entries(context).map(([k, v]) => `${k}=${String(v).replace(/[|=]/g, '_')}`).join('|');
                params = `context=${contextStr}&folder=${FOLDER}&timestamp=${timestamp}`;
            }
            const signature = crypto.createHash('sha1')
                .update(params + SECRET)
                .digest('hex');
            return {
                statusCode: 200, headers,
                body: JSON.stringify({ timestamp, signature, api_key: KEY, cloud_name: CLOUD, folder: FOLDER, context: contextStr })
            };


        }

        // ── DELETE a resource ──
        if (event.httpMethod === 'POST' && action === 'delete') {
            const { public_id, resource_type = 'image' } = JSON.parse(event.body || '{}');
            if (!public_id) return { statusCode: 400, headers, body: JSON.stringify({ error: 'No public_id' }) };
            const crypto = require('crypto');
            const timestamp = Math.round(Date.now() / 1000);
            const signature = crypto.createHash('sha1')
                .update(`public_id=${public_id}&timestamp=${timestamp}${SECRET}`)
                .digest('hex');
            const formBody = `public_id=${encodeURIComponent(public_id)}&timestamp=${timestamp}&api_key=${KEY}&signature=${signature}`;
            const r = await httpsRequest(
                `https://api.cloudinary.com/v1_1/${CLOUD}/${resource_type}/destroy`,
                { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Authorization': authHeader } },
                formBody
            );
            return { statusCode: 200, headers, body: JSON.stringify(r.body) };
        }

        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Unknown action' }) };
    } catch (err) {
        return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
    }
};
