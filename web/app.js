(function () {
      const DEFAULT_API = 'http://localhost:8888';
      let apiBase = localStorage.getItem('dbrag_api_base') || DEFAULT_API;

      const thread = document.getElementById('thread');
      const emptyState = document.getElementById('emptyState');
      const input = document.getElementById('input');
      const sendBtn = document.getElementById('sendBtn');
      const statusDot = document.getElementById('statusDot');
      const statusText = document.getElementById('statusText');
      const modelTag = document.getElementById('modelTag');
      const settingsBtn = document.getElementById('settingsBtn');
      
      const settingsModalBackdrop = document.getElementById('settingsModalBackdrop');
      const modalCloseBtn = document.getElementById('modalCloseBtn');
      const tabBtns = document.querySelectorAll('.tab-btn');
      const tabPanes = document.querySelectorAll('.tab-pane');
      
      const dbStatusBadge = document.getElementById('dbStatusBadge');
      const modeUrlBtn = document.getElementById('modeUrlBtn');
      const modeFieldsBtn = document.getElementById('modeFieldsBtn');
      const urlFormSection = document.getElementById('urlFormSection');
      const fieldsFormSection = document.getElementById('fieldsFormSection');

      const apiUrlInput = document.getElementById('apiUrlInput');
      const settingsSave = document.getElementById('settingsSave');
      const examplesWrap = document.getElementById('examples');

      // Connection fields
      const groqApiKeyInput = document.getElementById('groqApiKeyInput');
      const dbTypeSelect = document.getElementById('dbTypeSelect');
      
      const sqlVisibilityShow = document.getElementById('sqlVisibilityShow');
      const sqlVisibilityHide = document.getElementById('sqlVisibilityHide');
      const answerVisibilityShow = document.getElementById('answerVisibilityShow');
      const answerVisibilityHide = document.getElementById('answerVisibilityHide');

      const sqlUrlGroup = document.getElementById('sqlUrlGroup');
      const esUrlGroup = document.getElementById('esUrlGroup');
      const dbUrlLabel = document.getElementById('dbUrlLabel');
      const dbUrlInput = document.getElementById('dbUrlInput');

      // Elasticsearch Specific inputs
      const esUrlInput = document.getElementById('esUrlInput');
      const esIndexFilterInput = document.getElementById('esIndexFilterInput');

      // Granular fields
      const dbHostInput = document.getElementById('dbHostInput');
      const dbPortInput = document.getElementById('dbPortInput');
      const dbNameInput = document.getElementById('dbNameInput');
      const dbUserInput = document.getElementById('dbUserInput');
      const dbPassInput = document.getElementById('dbPassInput');
      const mssqlExtraFields = document.getElementById('mssqlExtraFields');
      const dbOdbcDriverInput = document.getElementById('dbOdbcDriverInput');
      const dbTrustCertCheckbox = document.getElementById('dbTrustCertCheckbox');

      const esFieldsGroup = document.getElementById('esFieldsGroup');
      const sqlFieldsGroup = document.getElementById('sqlFieldsGroup');
      const esHostInput = document.getElementById('esHostInput');
      const esFieldsUserInput = document.getElementById('esUserInput');
      const esPassInput = document.getElementById('esPassInput');
      const esApiKeyInput = document.getElementById('esApiKeyInput');
      const esFieldsFilterInput = document.getElementById('esFieldsFilterInput');
      const schemaPreviewArea = document.getElementById('schemaPreviewArea');

      let connectionMode = localStorage.getItem('dbrag_conn_mode') || 'url';

      // Toggle DB Type Section and update placeholders
      dbTypeSelect.addEventListener('change', () => {
        const val = dbTypeSelect.value;
        
        if (val === 'elasticsearch') {
          sqlUrlGroup.style.display = 'none';
          esUrlGroup.style.display = 'flex';
          
          sqlFieldsGroup.style.display = 'none';
          esFieldsGroup.style.display = 'flex';
        } else {
          sqlUrlGroup.style.display = 'flex';
          esUrlGroup.style.display = 'none';
          
          sqlFieldsGroup.style.display = 'flex';
          esFieldsGroup.style.display = 'none';

          if (val === 'sqlite') {
            dbUrlLabel.textContent = 'SQLite Database Path / Connection URL';
            dbUrlInput.placeholder = 'sqlite:///local.db';
          } else {
            dbUrlLabel.textContent = 'CONNECTION URL';
            const placeholders = {
              postgres: 'postgresql+psycopg2://user:pass@host:port/db',
              mysql: 'mysql+pymysql://user:pass@host:port/db',
              mariadb: 'mysql+pymysql://user:pass@host:port/db',
              mssql: 'mssql+pymssql://user:pass@host:port/db'
            };
            dbUrlInput.placeholder = placeholders[val] || '';
          }
        }

        if (val === 'mssql') {
          mssqlExtraFields.style.display = 'flex';
        } else {
          mssqlExtraFields.style.display = 'none';
        }
      });

      // Connection Mode switching
      function setConnectionMode(mode) {
        connectionMode = mode;
        localStorage.setItem('dbrag_conn_mode', mode);
        if (mode === 'url') {
          modeUrlBtn.classList.add('active');
          modeFieldsBtn.classList.remove('active');
          urlFormSection.style.display = 'block';
          fieldsFormSection.style.display = 'none';
        } else {
          modeUrlBtn.classList.remove('active');
          modeFieldsBtn.classList.add('active');
          urlFormSection.style.display = 'none';
          fieldsFormSection.style.display = 'block';
        }
      }

      modeUrlBtn.addEventListener('click', () => setConnectionMode('url'));
      modeFieldsBtn.addEventListener('click', () => setConnectionMode('fields'));

      // Tab switching logic
      tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
          tabBtns.forEach(b => b.classList.remove('active'));
          tabPanes.forEach(p => p.classList.remove('active'));
          
          btn.classList.add('active');
          const targetPane = document.getElementById(btn.dataset.tab);
          if (targetPane) targetPane.classList.add('active');
        });
      });

      // Modal display controls
      settingsBtn.addEventListener('click', () => {
        settingsModalBackdrop.classList.add('open');
      });
      modalCloseBtn.addEventListener('click', () => {
        settingsModalBackdrop.classList.remove('open');
      });
      settingsModalBackdrop.addEventListener('click', (e) => {
        if (e.target === settingsModalBackdrop) {
          settingsModalBackdrop.classList.remove('open');
        }
      });

      // Toggle SQL query visibility locally
      sqlVisibilityShow.addEventListener('change', () => {
        localStorage.setItem('dbrag_show_sql', 'true');
        thread.classList.remove('hide-sql');
      });
      sqlVisibilityHide.addEventListener('change', () => {
        localStorage.setItem('dbrag_show_sql', 'false');
        thread.classList.add('hide-sql');
      });

      // Toggle Text Answer visibility locally
      answerVisibilityShow.addEventListener('change', () => {
        localStorage.setItem('dbrag_show_answer', 'true');
        thread.classList.remove('hide-answers');
      });
      answerVisibilityHide.addEventListener('change', () => {
        localStorage.setItem('dbrag_show_answer', 'false');
        thread.classList.add('hide-answers');
      });

      // Load saved connection configurations
      apiUrlInput.value = apiBase;
      groqApiKeyInput.value = localStorage.getItem('dbrag_groq_key') || '';

      const savedShowSql = localStorage.getItem('dbrag_show_sql') !== 'false';
      if (savedShowSql) {
        sqlVisibilityShow.checked = true;
        thread.classList.remove('hide-sql');
      } else {
        sqlVisibilityHide.checked = true;
        thread.classList.add('hide-sql');
      }

      const savedShowAnswer = localStorage.getItem('dbrag_show_answer') !== 'false';
      if (savedShowAnswer) {
        answerVisibilityShow.checked = true;
        thread.classList.remove('hide-answers');
      } else {
        answerVisibilityHide.checked = true;
        thread.classList.add('hide-answers');
      }

      const savedDbType = localStorage.getItem('dbrag_db_type') || 'postgres';
      dbTypeSelect.value = savedDbType;

      // Load URL fields
      dbUrlInput.value = localStorage.getItem('dbrag_db_url') || '';
      esUrlInput.value = localStorage.getItem('dbrag_es_url') || '';
      esIndexFilterInput.value = localStorage.getItem('dbrag_es_index_filter') || '';

      // Load Detailed fields
      dbHostInput.value = localStorage.getItem('dbrag_db_host') || '';
      dbPortInput.value = localStorage.getItem('dbrag_db_port') || '';
      dbNameInput.value = localStorage.getItem('dbrag_db_name') || '';
      dbUserInput.value = localStorage.getItem('dbrag_db_user') || '';
      dbPassInput.value = localStorage.getItem('dbrag_db_pass') || '';
      dbOdbcDriverInput.value = localStorage.getItem('dbrag_db_odbc') || 'ODBC Driver 18 for SQL Server';
      dbTrustCertCheckbox.checked = localStorage.getItem('dbrag_db_trust') !== 'false';

      esHostInput.value = localStorage.getItem('dbrag_es_host') || '';
      esFieldsUserInput.value = localStorage.getItem('dbrag_es_fields_user') || '';
      esPassInput.value = localStorage.getItem('dbrag_es_fields_pass') || '';
      esApiKeyInput.value = localStorage.getItem('dbrag_es_fields_apikey') || '';
      esFieldsFilterInput.value = localStorage.getItem('dbrag_es_fields_filter') || '';

      // Trigger change and mode loaders
      dbTypeSelect.dispatchEvent(new Event('change'));
      setConnectionMode(connectionMode);

      const EXAMPLES = [
        'How many records are in each table?',
        'What does the most recent entry look like?',
        'Show me a breakdown by category'
      ];
      EXAMPLES.forEach(q => {
        const chip = document.createElement('button');
        chip.className = 'example-chip';
        chip.textContent = q;
        chip.addEventListener('click', () => { input.value = q; sendQuestion(); });
        examplesWrap.appendChild(chip);
      });

      function getConnectionPayload() {
        const dbType = dbTypeSelect.value;
        const payload = {};

        const groqKey = groqApiKeyInput.value.trim();
        if (groqKey) payload.groq_api_key = groqKey;

        payload.db_type = dbType;

        if (connectionMode === 'url') {
          if (dbType === 'elasticsearch') {
            const url = esUrlInput.value.trim();
            if (url) payload.es_url = url;
            const filter = esIndexFilterInput.value.trim();
            if (filter) payload.es_index_filter = filter;
          } else {
            const url = dbUrlInput.value.trim();
            if (url) {
              payload.db_url = url;
              if (dbType === 'sqlite') {
                payload.sqlite_path = url;
              }
            }
          }
        } else {
          if (dbType === 'elasticsearch') {
            const url = esHostInput.value.trim();
            if (url) payload.es_url = url;
            const user = esFieldsUserInput.value.trim();
            if (user) payload.es_user = user;
            const pwd = esPassInput.value.trim();
            if (pwd) payload.es_password = pwd;
            const apiKey = esApiKeyInput.value.trim();
            if (apiKey) payload.es_api_key = apiKey;
            const filter = esFieldsFilterInput.value.trim();
            if (filter) payload.es_index_filter = filter;
          } else if (dbType === 'sqlite') {
            const url = dbUrlInput.value.trim();
            if (url) {
              payload.db_url = url;
              payload.sqlite_path = url;
            }
          } else {
            const host = dbHostInput.value.trim();
            if (host) payload.host = host;
            const port = parseInt(dbPortInput.value.trim(), 10);
            if (!isNaN(port)) payload.port = port;
            const database = dbNameInput.value.trim();
            if (database) payload.database = database;
            const username = dbUserInput.value.trim();
            if (username) payload.username = username;
            const password = dbPassInput.value.trim();
            if (password) payload.password = password;

            if (dbType === 'mssql') {
              const odbc = dbOdbcDriverInput.value.trim();
              if (odbc) payload.odbc_driver = odbc;
              payload.trust_server_certificate = dbTrustCertCheckbox.checked;
            }
          }
        }
        return payload;
      }

      settingsSave.addEventListener('click', () => {
        const val = apiUrlInput.value.trim().replace(/\/$/, '');
        if (val) {
          apiBase = val;
          localStorage.setItem('dbrag_api_base', apiBase);
        }
        localStorage.setItem('dbrag_groq_key', groqApiKeyInput.value.trim());
        localStorage.setItem('dbrag_db_type', dbTypeSelect.value);
        
        localStorage.setItem('dbrag_db_url', dbUrlInput.value.trim());
        localStorage.setItem('dbrag_es_url', esUrlInput.value.trim());
        localStorage.setItem('dbrag_es_index_filter', esIndexFilterInput.value.trim());

        localStorage.setItem('dbrag_db_host', dbHostInput.value.trim());
        localStorage.setItem('dbrag_db_port', dbPortInput.value.trim());
        localStorage.setItem('dbrag_db_name', dbNameInput.value.trim());
        localStorage.setItem('dbrag_db_user', dbUserInput.value.trim());
        localStorage.setItem('dbrag_db_pass', dbPassInput.value.trim());
        localStorage.setItem('dbrag_db_odbc', dbOdbcDriverInput.value.trim());
        localStorage.setItem('dbrag_db_trust', dbTrustCertCheckbox.checked);

        localStorage.setItem('dbrag_es_host', esHostInput.value.trim());
        localStorage.setItem('dbrag_es_fields_user', esFieldsUserInput.value.trim());
        localStorage.setItem('dbrag_es_fields_pass', esPassInput.value.trim());
        localStorage.setItem('dbrag_es_fields_apikey', esApiKeyInput.value.trim());
        localStorage.setItem('dbrag_es_fields_filter', esFieldsFilterInput.value.trim());

        settingsModalBackdrop.classList.remove('open');
        checkHealth();
        triggerSchemaRefresh();
      });

      let schemaRefreshedAt = null;
      let schemaTtlSeconds = 60;

      const schemaRefreshBtn = document.getElementById('schemaRefreshBtn');
      const schemaRefreshInfo = document.getElementById('schemaRefreshInfo');

      function formatAge(isoString) {
        if (!isoString) return 'unknown';
        const diff = Math.floor((Date.now() - new Date(isoString).getTime()) / 1000);
        if (diff < 5) return 'just now';
        if (diff < 60) return `${diff}s ago`;
        if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
        return `${Math.floor(diff / 3600)}h ago`;
      }

      function updateSchemaAgeLabel() {
        if (schemaRefreshedAt) {
          schemaRefreshInfo.textContent = `schema read ${formatAge(schemaRefreshedAt)} · auto every ${schemaTtlSeconds}s`;
        }
      }

      function updateDbStatusBadge(isOnline) {
        if (isOnline) {
          dbStatusBadge.className = 'status-badge connected';
          dbStatusBadge.innerHTML = '<span class="status-dot-inner"></span>Connected';
        } else {
          dbStatusBadge.className = 'status-badge disconnected';
          dbStatusBadge.innerHTML = '<span class="status-dot-inner"></span>Disconnected';
        }
      }

      function renderSchemaPreview(schemaDoc) {
        if (!schemaDoc || schemaDoc.startsWith('(schema not yet loaded)') || schemaDoc === '(no tables found)') {
          schemaPreviewArea.innerHTML = `<div style="color: var(--text-faint); font-style: italic;">No schema loaded yet. Connect to a database to introspect tables.</div>`;
          return;
        }

        const tables = schemaDoc.split('\n\n');
        let html = '';
        tables.forEach(tableBlock => {
          const lines = tableBlock.trim().split('\n');
          if (lines.length === 0) return;
          const tableHeader = lines[0].replace('TABLE ', '').replace(':', '');
          let columnsStr = '';
          let fKeysStr = '';
          lines.slice(1).forEach(line => {
            const trimmed = line.trim();
            if (trimmed.startsWith('columns:')) {
              columnsStr = trimmed.replace('columns:', '').trim();
            } else if (trimmed.startsWith('foreign_keys:')) {
              fKeysStr = trimmed.replace('foreign_keys:', '').trim();
            }
          });

          html += `
            <div class="schema-preview-table">
              <div class="schema-preview-table-name">📁 ${escapeHtml(tableHeader)}</div>
              <div class="schema-preview-cols">
                <strong>Columns:</strong> ${escapeHtml(columnsStr)}
                ${fKeysStr ? `<br/><strong>Foreign Keys:</strong> ${escapeHtml(fKeysStr)}` : ''}
              </div>
            </div>
          `;
        });
        schemaPreviewArea.innerHTML = html;
      }

      async function fetchSchemaContent(payload) {
        try {
          const res = await fetch(apiBase + '/schema', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ connection: payload })
          });
          if (res.ok) {
            const data = await res.json().catch(() => ({}));
            if (data.schema) {
              renderSchemaPreview(data.schema);
            }
          }
        } catch (e) {
          console.error("Failed to load schema preview on health check:", e);
        }
      }

      async function checkHealth() {
        statusText.textContent = 'checking';
        statusDot.className = 'status-dot';
        try {
          const payload = getConnectionPayload();
          const res = await fetch(apiBase + '/health', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ connection: payload })
          });
          if (!res.ok) throw new Error('bad status');
          const data = await res.json().catch(() => ({}));
          statusDot.className = 'status-dot online';
          statusText.textContent = 'connected';
          updateDbStatusBadge(true);
          if (data.model) modelTag.textContent = data.model;
          if (data.schema_refreshed_at) {
            schemaRefreshedAt = data.schema_refreshed_at;
            schemaTtlSeconds = data.schema_ttl_seconds || 60;
            updateSchemaAgeLabel();
          }
          fetchSchemaContent(payload);
        } catch (e) {
          statusDot.className = 'status-dot error';
          statusText.textContent = 'offline';
          modelTag.textContent = 'unavailable';
          updateDbStatusBadge(false);
        }
      }

      async function triggerSchemaRefresh() {
        schemaRefreshBtn.disabled = true;
        schemaRefreshBtn.classList.add('spinning');
        schemaRefreshInfo.textContent = 'refreshing…';
        try {
          const res = await fetch(apiBase + '/schema/refresh', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ connection: getConnectionPayload() })
          });
          if (!res.ok) throw new Error('refresh failed');
          const data = await res.json().catch(() => ({}));
          const changed = data.changed;
          schemaRefreshInfo.textContent = changed
            ? `✓ Schema updated just now`
            : `✓ No changes (read just now)`;

          if (data.refreshed_at) {
            schemaRefreshedAt = data.refreshed_at;
            setTimeout(updateSchemaAgeLabel, 3000);
          }
          statusDot.className = 'status-dot online';
          statusText.textContent = 'connected';
          updateDbStatusBadge(true);
          if (data.schema) {
            renderSchemaPreview(data.schema);
          }
        } catch (e) {
          schemaRefreshInfo.textContent = 'refresh failed — check connection settings';
          statusDot.className = 'status-dot error';
          statusText.textContent = 'offline';
          updateDbStatusBadge(false);
        } finally {
          schemaRefreshBtn.disabled = false;
          setTimeout(() => schemaRefreshBtn.classList.remove('spinning'), 500);
        }
      }

      checkHealth();
      // Keep the "schema read X ago" label ticking locally without hitting the server
      setInterval(updateSchemaAgeLabel, 5000);

      schemaRefreshBtn.addEventListener('click', triggerSchemaRefresh);

      // Auto-resize textarea
      input.addEventListener('input', () => {
        input.style.height = 'auto';
        input.style.height = Math.min(input.scrollHeight, 140) + 'px';
      });

      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          sendQuestion();
        }
      });

      sendBtn.addEventListener('click', sendQuestion);

      function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = String(str);
        return div.innerHTML;
      }

      function buildDataTable(rows) {
        if (!rows || rows.length === 0) return '';
        const cols = Object.keys(rows[0]);
        const preview = rows.slice(0, 25);
        let html = '<div class="data-table-wrap"><table class="data-table"><thead><tr>';
        cols.forEach(c => html += `<th>${escapeHtml(c)}</th>`);
        html += '</tr></thead><tbody>';
        preview.forEach(r => {
          html += '<tr>';
          cols.forEach(c => html += `<td>${escapeHtml(r[c])}</td>`);
          html += '</tr>';
        });
        html += '</tbody></table></div>';
        if (rows.length > preview.length) {
          html += `<div class="row-count-tag" style="margin-top:6px;">showing ${preview.length} of ${rows.length} rows</div>`;
        }
        return html;
      }

      async function triggerAskEdit(turn, thinkingEl, question) {
        try {
          const res = await fetch(apiBase + '/ask', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              question,
              connection: getConnectionPayload()
            })
          });

          if (!res.ok) {
            const text = await res.text().catch(() => res.statusText);
            renderResult(turn, thinkingEl, null, `Request failed (${res.status}): ${text}`);
            statusDot.className = 'status-dot error';
            statusText.textContent = 'error';
            return;
          }

          const data = await res.json();
          renderResult(turn, thinkingEl, data, null);
          statusDot.className = 'status-dot online';
          statusText.textContent = 'connected';
        } catch (e) {
          renderResult(turn, thinkingEl, null, `Could not reach API at ${apiBase}. Check that the server is running and the URL is correct in settings.`);
          statusDot.className = 'status-dot error';
          statusText.textContent = 'offline';
        }
      }

      function addTurn(question) {
        if (emptyState) { emptyState.remove(); }

        const turn = document.createElement('div');
        turn.className = 'turn';

        const qRow = document.createElement('div');
        qRow.className = 'question-row';
        
        const editBtn = document.createElement('button');
        editBtn.className = 'edit-btn';
        editBtn.title = 'Edit Question';
        editBtn.innerHTML = '✏️';
        
        const qBubble = document.createElement('div');
        qBubble.className = 'question-bubble';
        qBubble.textContent = question;
        
        qRow.appendChild(editBtn);
        qRow.appendChild(qBubble);
        turn.appendChild(qRow);

        const thinking = document.createElement('div');
        thinking.className = 'thinking';
        thinking.innerHTML = `<div class="thinking-dots"><span></span><span></span><span></span></div> generating SQL`;
        turn.appendChild(thinking);

        thread.appendChild(turn);
        thread.scrollTop = thread.scrollHeight;

        editBtn.addEventListener('click', () => {
          const originalText = qBubble.textContent;
          editBtn.style.display = 'none';
          
          qBubble.innerHTML = '';
          const textarea = document.createElement('textarea');
          textarea.value = originalText;
          textarea.style.width = '100%';
          textarea.style.background = 'var(--bg)';
          textarea.style.border = '1px solid var(--border)';
          textarea.style.color = 'var(--text)';
          textarea.style.borderRadius = '6px';
          textarea.style.padding = '6px';
          textarea.style.fontFamily = 'var(--font-sans)';
          textarea.style.fontSize = '14px';
          textarea.style.resize = 'vertical';
          
          const btnGroup = document.createElement('div');
          btnGroup.style.display = 'flex';
          btnGroup.style.gap = '8px';
          btnGroup.style.marginTop = '6px';
          btnGroup.style.justifyContent = 'flex-end';
          
          const saveBtn = document.createElement('button');
          saveBtn.textContent = 'Save';
          saveBtn.className = 'settings-save';
          saveBtn.style.margin = '0';
          saveBtn.style.padding = '4px 10px';
          
          const cancelBtn = document.createElement('button');
          cancelBtn.textContent = 'Cancel';
          cancelBtn.className = 'schema-refresh-btn';
          cancelBtn.style.padding = '4px 10px';
          
          btnGroup.appendChild(cancelBtn);
          btnGroup.appendChild(saveBtn);
          qBubble.appendChild(textarea);
          qBubble.appendChild(btnGroup);
          
          cancelBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            qBubble.textContent = originalText;
            editBtn.style.display = 'inline-block';
          });
          
          saveBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const newQuestion = textarea.value.trim();
            if (!newQuestion) return;
            
            qBubble.textContent = newQuestion;
            editBtn.style.display = 'inline-block';
            
            // Truncate thread siblings after this turn
            while (turn.nextSibling) {
              turn.nextSibling.remove();
            }
            
            // Clear results elements of this turn
            while (turn.childNodes.length > 1) {
              turn.lastChild.remove();
            }
            
            const newThinking = document.createElement('div');
            newThinking.className = 'thinking';
            newThinking.innerHTML = `<div class="thinking-dots"><span></span><span></span><span></span></div> generating SQL`;
            turn.appendChild(newThinking);
            
            await triggerAskEdit(turn, newThinking, newQuestion);
          });
        });

        return { turn, thinking };
      }

      function renderResult(turn, thinkingEl, result, errMsg) {
        thinkingEl.remove();

        if (errMsg) {
          const aRow = document.createElement('div');
          aRow.className = 'answer-row';
          const bubble = document.createElement('div');
          bubble.className = 'answer-bubble error';
          bubble.textContent = errMsg;
          aRow.appendChild(bubble);
          turn.appendChild(aRow);
          thread.scrollTop = thread.scrollHeight;
          return;
        }

        // SQL strip
        if (result.sql) {
          const strip = document.createElement('div');
          strip.className = 'sql-strip fresh';
          strip.innerHTML = `
        <div class="sql-strip-head">
          <span class="sql-strip-label"><span class="dot"></span>SQL${result.row_count != null ? ` <span class="row-count-tag">· ${result.row_count} row${result.row_count === 1 ? '' : 's'}</span>` : ''}</span>
          <span class="sql-strip-toggle">▾</span>
        </div>
        <div class="sql-strip-body"><pre>${escapeHtml(result.sql)}</pre></div>
      `;
          strip.querySelector('.sql-strip-head').addEventListener('click', () => {
            strip.classList.toggle('collapsed');
          });
          turn.appendChild(strip);
          setTimeout(() => strip.classList.remove('fresh'), 1200);
        }

        if (result.error) {
          const aRow = document.createElement('div');
          aRow.className = 'answer-row';
          const bubble = document.createElement('div');
          bubble.className = 'answer-bubble error';
          bubble.textContent = result.error;
          aRow.appendChild(bubble);
          turn.appendChild(aRow);
          thread.scrollTop = thread.scrollHeight;
          return;
        }

        // Answer
        const aRow = document.createElement('div');
        aRow.className = 'answer-row';
        const bubble = document.createElement('div');
        bubble.className = 'answer-bubble';
        bubble.textContent = result.answer || '(no answer returned)';
        aRow.appendChild(bubble);
        turn.appendChild(aRow);

        // Data table if there are rows
        if (result.rows && result.rows.length > 0) {
          const tableWrap = document.createElement('div');
          tableWrap.innerHTML = buildDataTable(result.rows);
          turn.appendChild(tableWrap);
        }

        thread.scrollTop = thread.scrollHeight;
      }

      async function sendQuestion() {
        const question = input.value.trim();
        if (!question) return;

        input.value = '';
        input.style.height = 'auto';
        sendBtn.disabled = true;

        const { turn, thinking } = addTurn(question);

        try {
          const res = await fetch(apiBase + '/ask', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              question,
              connection: getConnectionPayload()
            })
          });

          if (!res.ok) {
            const text = await res.text().catch(() => res.statusText);
            renderResult(turn, thinking, null, `Request failed (${res.status}): ${text}`);
            statusDot.className = 'status-dot error';
            statusText.textContent = 'error';
            return;
          }

          const data = await res.json();
          renderResult(turn, thinking, data, null);
          statusDot.className = 'status-dot online';
          statusText.textContent = 'connected';
        } catch (e) {
          renderResult(turn, thinking, null, `Could not reach API at ${apiBase}. Check that the server is running and the URL is correct in settings.`);
          statusDot.className = 'status-dot error';
          statusText.textContent = 'offline';
        } finally {
          sendBtn.disabled = false;
        }
      }
    })();