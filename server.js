const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const pool = require('./database');
require('dotenv').config();

const app = express();
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'ngrok-skip-browser-warning'],
  credentials: false
}));
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ limit: '10mb', extended: true }));

// Health check
app.get('/health', (req, res) => res.json({ status: 'OK' }));

// Get data by TLD
app.get('/api/idn-data/:cctld', async (req, res) => {
  try {
    const { cctld } = req.params;
    const result = await pool.query(
      'SELECT * FROM idn_survey_data WHERE LOWER(cctld) = LOWER($1)',
      [cctld]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'TLD not found' });
    }
    const data = result.rows[0];
    delete data.email_id;
    delete data.created_at;
    delete data.last_updated;
    res.json({ success: true, data: data });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Submit survey - WITH LOGGING
app.post('/api/submit-survey', async (req, res) => {
  try {
    console.log('📥 Webhook received from Alchemer');
    console.log('Body:', JSON.stringify(req.body, null, 2));
    
    const b = req.body;
    
    if (!b.cctld) {
      console.log('❌ Missing cctld field');
      return res.status(400).json({ success: false, error: 'TLD required' });
    }
    
    // Handle scripts_offered as array or string
    let scripts = b.scripts_offered;
    if (Array.isArray(scripts)) {
      scripts = scripts.join(', ');
    }
    
    const result = await pool.query(
      `INSERT INTO idn_survey_submissions (cctld, email_id, country, organisationname, idn_registrations_supported, scripts_offered, idn_characters_supported, homoglyph_bundling, year_idn_introduced, form_idn_record_registry_db, form_idn_display_ui_registry, form_idn_display_port43_whois, form_idn_display_web_whois, form_idn_display_rdap, idn_whoisrdap_display, unicode_mailbox_permitted, unicode_mailbox_users, unicode_mailbox_formats, guaranteed_eai_support, mail_server_unicode_support, mail_server_unicode_formats, eai_deployment_plans, mta_software, mua_software, registry_backend_software, idn_spec_version, additional_notes, approval_status) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, 'pending') RETURNING id`,
      [
        b.cctld,
        b.email_id || null,
        b.country || null,
        b.organisationname || null,
        b.idn_registrations_supported || null,
        scripts || null,
        b.idn_characters_supported || null,
        b.homoglyph_bundling || null,
        b.year_idn_introduced || null,
        b.form_idn_record_registry_db || null,
        b.form_idn_display_ui_registry || null,
        b.form_idn_display_port43_whois || null,
        b.form_idn_display_web_whois || null,
        b.form_idn_display_rdap || null,
        b.idn_whoisrdap_display || null,
        b.unicode_mailbox_permitted || null,
        b.unicode_mailbox_users || null,
        b.unicode_mailbox_formats || null,
        b.guaranteed_eai_support || null,
        b.mail_server_unicode_support || null,
        b.mail_server_unicode_formats || null,
        b.eai_deployment_plans || null,
        b.mta_software || null,
        b.mua_software || null,
        b.registry_backend_software || null,
        b.idn_spec_version || null,
        b.additional_notes || null
      ]
    );
    
    console.log('✅ Submission saved! ID:', result.rows[0].id);
    res.json({ success: true, submissionId: result.rows[0].id });
  } catch (error) {
    console.error('❌ Error saving submission:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get pending submissions
app.get('/api/submissions/pending', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM idn_survey_submissions WHERE approval_status = $1 ORDER BY submission_date DESC',
      ['pending']
    );
    res.json({ success: true, count: result.rows.length, submissions: result.rows });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Approve submission
app.post('/api/approve/:submissionId', async (req, res) => {
  try {
    const sub = await pool.query('SELECT * FROM idn_survey_submissions WHERE id = $1', [req.params.submissionId]);
    if (sub.rows.length === 0) return res.status(404).json({ success: false });
    
    const d = sub.rows[0];
    await pool.query(`INSERT INTO idn_survey_data (cctld, country, organisationname, email_id, idn_registrations_supported, scripts_offered, idn_characters_supported, homoglyph_bundling, year_idn_introduced, form_idn_record_registry_db, form_idn_display_ui_registry, form_idn_display_port43_whois, form_idn_display_web_whois, form_idn_display_rdap, idn_whoisrdap_display, unicode_mailbox_permitted, unicode_mailbox_users, unicode_mailbox_formats, guaranteed_eai_support, mail_server_unicode_support, mail_server_unicode_formats, eai_deployment_plans, mta_software, mua_software, registry_backend_software, idn_spec_version, additional_notes, last_updated) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, NOW()) ON CONFLICT (cctld) DO UPDATE SET country = $2, organisationname = $3, email_id = $4, idn_registrations_supported = $5, scripts_offered = $6, last_updated = NOW()`, [d.cctld, d.country, d.organisationname, d.email_id, d.idn_registrations_supported, d.scripts_offered, d.idn_characters_supported, d.homoglyph_bundling, d.year_idn_introduced, d.form_idn_record_registry_db, d.form_idn_display_ui_registry, d.form_idn_display_port43_whois, d.form_idn_display_web_whois, d.form_idn_display_rdap, d.idn_whoisrdap_display, d.unicode_mailbox_permitted, d.unicode_mailbox_users, d.unicode_mailbox_formats, d.guaranteed_eai_support, d.mail_server_unicode_support, d.mail_server_unicode_formats, d.eai_deployment_plans, d.mta_software, d.mua_software, d.registry_backend_software, d.idn_spec_version, d.additional_notes]);
    await pool.query('UPDATE idn_survey_submissions SET approval_status = $1, reviewed_at = NOW() WHERE id = $2', ['approved', req.params.submissionId]);
    
    console.log('✅ Submission approved and moved to idn_survey_data');
    res.json({ success: true });
  } catch (error) {
    console.error('❌ Error approving:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});
// Reject submission
app.post('/api/reject/:submissionId', async (req, res) => {
  try {
    const { reason } = req.body;
    await pool.query(
      'UPDATE idn_survey_submissions SET approval_status = $1, rejection_reason = $2, reviewed_at = NOW() WHERE id = $3',
      ['rejected', reason || 'No reason provided', req.params.submissionId]
    );
    console.log('❌ Submission rejected:', req.params.submissionId);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get submission with comparison to existing data
app.get('/api/submission/:submissionId/compare', async (req, res) => {
  try {
    const submission = await pool.query(
      'SELECT * FROM idn_survey_submissions WHERE id = $1',
      [req.params.submissionId]
    );
    
    if (submission.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Submission not found' });
    }
    
    const existing = await pool.query(
      'SELECT * FROM idn_survey_data WHERE LOWER(cctld) = LOWER($1)',
      [submission.rows[0].cctld]
    );
    
    res.json({
      success: true,
      submission: submission.rows[0],
      existing: existing.rows.length > 0 ? existing.rows[0] : null
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Serve admin dashboard
app.get('/admin', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>IDN Survey Admin Dashboard</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: #f5f5f5;
            padding: 20px;
        }
        .container {
            max-width: 1400px;
            margin: 0 auto;
            background: white;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            padding: 30px;
        }
        h1 {
            color: #333;
            margin-bottom: 10px;
        }
        .stats {
            display: flex;
            gap: 20px;
            margin: 20px 0;
        }
        .stat-box {
            background: #f8f9fa;
            padding: 15px 25px;
            border-radius: 6px;
            border-left: 4px solid #007bff;
        }
        .stat-box h3 {
            font-size: 24px;
            color: #007bff;
        }
        .stat-box p {
            color: #666;
            font-size: 14px;
        }
        .submissions {
            margin-top: 30px;
        }
        .submission-card {
            border: 1px solid #ddd;
            border-radius: 8px;
            padding: 20px;
            margin-bottom: 20px;
            background: #fafafa;
        }
        .submission-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 15px;
            padding-bottom: 15px;
            border-bottom: 2px solid #e0e0e0;
        }
        .submission-header h3 {
            color: #333;
            font-size: 20px;
        }
        .submission-meta {
            color: #666;
            font-size: 14px;
        }
        .comparison-table {
            width: 100%;
            border-collapse: collapse;
            margin: 15px 0;
        }
        .comparison-table th {
            background: #007bff;
            color: white;
            padding: 12px;
            text-align: left;
            font-weight: 600;
        }
        .comparison-table td {
            padding: 10px 12px;
            border-bottom: 1px solid #ddd;
        }
        .comparison-table tr:hover {
            background: #f0f0f0;
        }
        .changed {
            background-color: #fff3cd !important;
        }
        .new-value {
            font-weight: bold;
            color: #0056b3;
        }
        .old-value {
            color: #666;
            font-style: italic;
        }
        .actions {
            display: flex;
            gap: 10px;
            margin-top: 15px;
        }
        button {
            padding: 10px 20px;
            border: none;
            border-radius: 5px;
            cursor: pointer;
            font-size: 14px;
            font-weight: 600;
            transition: all 0.3s;
        }
        .btn-approve {
            background: #28a745;
            color: white;
        }
        .btn-approve:hover {
            background: #218838;
        }
        .btn-reject {
            background: #dc3545;
            color: white;
        }
        .btn-reject:hover {
            background: #c82333;
        }
        .btn-view {
            background: #17a2b8;
            color: white;
        }
        .btn-view:hover {
            background: #138496;
        }
        .loading {
            text-align: center;
            padding: 40px;
            color: #666;
        }
        .no-submissions {
            text-align: center;
            padding: 60px;
            color: #999;
            font-size: 18px;
        }
        .badge {
            display: inline-block;
            padding: 4px 12px;
            border-radius: 12px;
            font-size: 12px;
            font-weight: 600;
        }
        .badge-new {
            background: #28a745;
            color: white;
        }
        .badge-update {
            background: #ffc107;
            color: #000;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>🔍 IDN Survey Admin Dashboard</h1>
        <p style="color: #666; margin-top: 5px;">Review and approve submissions</p>
        
        <div class="stats">
            <div class="stat-box">
                <h3 id="pending-count">-</h3>
                <p>Pending Submissions</p>
            </div>
        </div>

        <div class="submissions" id="submissions-container">
            <div class="loading">Loading submissions...</div>
        </div>
    </div>

    <script>
        const API_URL = window.location.origin;

        async function loadSubmissions() {
            try {
                const res = await fetch(\`\${API_URL}/api/submissions/pending\`);
                const data = await res.json();
                
                document.getElementById('pending-count').textContent = data.count || 0;
                
                const container = document.getElementById('submissions-container');
                
                if (data.count === 0) {
                    container.innerHTML = '<div class="no-submissions">✅ No pending submissions</div>';
                    return;
                }
                
                container.innerHTML = '';
                
                for (const sub of data.submissions) {
                    const card = await createSubmissionCard(sub);
                    container.appendChild(card);
                }
            } catch (error) {
                console.error('Error loading submissions:', error);
                document.getElementById('submissions-container').innerHTML = 
                    '<div class="no-submissions">❌ Error loading submissions</div>';
            }
        }

        async function createSubmissionCard(submission) {
            const card = document.createElement('div');
            card.className = 'submission-card';
            
            // Check if this is new or update
            const compareRes = await fetch(\`\${API_URL}/api/submission/\${submission.id}/compare\`);
            const compareData = await compareRes.json();
            const isNew = !compareData.existing;
            
            const date = new Date(submission.submission_date).toLocaleString();
            
            card.innerHTML = \`
                <div class="submission-header">
                    <div>
                        <h3>\${submission.cctld} - \${submission.country || 'N/A'}</h3>
                        <div class="submission-meta">
                            <span class="badge \${isNew ? 'badge-new' : 'badge-update'}">\${isNew ? 'NEW' : 'UPDATE'}</span>
                            Submitted: \${date} | Org: \${submission.organisationname || 'N/A'}
                        </div>
                    </div>
                </div>
                <div id="details-\${submission.id}"></div>
                <div class="actions">
                    <button class="btn-view" onclick="toggleDetails(\${submission.id})">
                        👁️ View Details
                    </button>
                    <button class="btn-approve" onclick="approveSubmission(\${submission.id})">
                        ✅ Approve
                    </button>
                    <button class="btn-reject" onclick="rejectSubmission(\${submission.id})">
                        ❌ Reject
                    </button>
                </div>
            \`;
            
            return card;
        }

        async function toggleDetails(id) {
            const detailsDiv = document.getElementById(\`details-\${id}\`);
            
            if (detailsDiv.innerHTML) {
                detailsDiv.innerHTML = '';
                return;
            }
            
            const res = await fetch(\`\${API_URL}/api/submission/\${id}/compare\`);
            const data = await res.json();
            
            const fields = [
                'country', 'organisationname', 'idn_registrations_supported', 
                'scripts_offered', 'homoglyph_bundling', 'year_idn_introduced',
                'form_idn_record_registry_db', 'form_idn_display_ui_registry',
                'unicode_mailbox_permitted', 'mta_software', 'registry_backend_software'
            ];
            
            let tableHTML = '<table class="comparison-table"><tr><th>Field</th><th>New Value</th><th>Current Value</th></tr>';
            
            for (const field of fields) {
                const newVal = data.submission[field] || '-';
                const oldVal = data.existing ? (data.existing[field] || '-') : '-';
                const changed = newVal !== oldVal;
                
                tableHTML += \`
                    <tr class="\${changed ? 'changed' : ''}">
                        <td><strong>\${field.replace(/_/g, ' ').toUpperCase()}</strong></td>
                        <td class="new-value">\${newVal}</td>
                        <td class="old-value">\${oldVal}</td>
                    </tr>
                \`;
            }
            
            tableHTML += '</table>';
            detailsDiv.innerHTML = tableHTML;
        }

        async function approveSubmission(id) {
            if (!confirm('Approve this submission and update the database?')) return;
            
            try {
                const res = await fetch(\`\${API_URL}/api/approve/\${id}\`, { method: 'POST' });
                const data = await res.json();
                
                if (data.success) {
                    alert('✅ Submission approved!');
                    loadSubmissions();
                } else {
                    alert('❌ Error: ' + data.error);
                }
            } catch (error) {
                alert('❌ Error approving submission');
            }
        }

        async function rejectSubmission(id) {
            const reason = prompt('Reason for rejection (optional):');
            if (reason === null) return;
            
            try {
                const res = await fetch(\`\${API_URL}/api/reject/\${id}\`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ reason })
                });
                const data = await res.json();
                
                if (data.success) {
                    alert('❌ Submission rejected');
                    loadSubmissions();
                } else {
                    alert('❌ Error: ' + data.error);
                }
            } catch (error) {
                alert('❌ Error rejecting submission');
            }
        }

        // Load on page load
        loadSubmissions();
        
        // Auto-refresh every 30 seconds
        setInterval(loadSubmissions, 30000);
    </script>
</body>
</html>
  `);
});

const PORT = process.env.PORT || 3002;
app.listen(PORT, () => console.log(`✓ Server running on port ${PORT}`));
