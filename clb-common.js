/* Phần dùng chung cho clb.html, clb-admin.html, quantri-tong.html */
(function () {
    'use strict';
    const CLB = (window.CLB = {});

    // ---------- Tiện ích văn bản ----------
    CLB.esc = function (value) {
        return String(value == null ? '' : value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    };
    CLB.norm = s => String(s == null ? '' : s).normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();
    CLB.isHttp = s => /^https?:\/\/[^\s]+$/i.test(String(s || ''));
    CLB.clubId = function () {
        const v = new URLSearchParams(location.search).get('id');
        return /^\d+$/.test(v || '') ? Number(v) : null;
    };
    CLB.pageUrl = (file, id) => new URL(file + (id != null ? '?id=' + id : ''), location.href).href;

    // ---------- Gọi API (Google Apps Script) ----------
    CLB.apiConfigured = () => /^https:\/\/script\.google\.com\/.+\/exec/.test((window.CLB_API_URL || '').trim());

    async function request(url, options) {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 90000);
        let res, text;
        try {
            res = await fetch(url, Object.assign({ signal: ctrl.signal }, options));
            text = await res.text();
        } catch (e) {
            throw Object.assign(new Error(e.name === 'AbortError' ? 'Máy chủ phản hồi quá lâu. Vui lòng thử lại.' : 'Không kết nối được máy chủ. Hãy kiểm tra mạng rồi thử lại.'), { code: 'NETWORK' });
        } finally { clearTimeout(timer); }
        let data;
        try { data = JSON.parse(text); } catch (e) {
            throw Object.assign(new Error('Máy chủ trả về dữ liệu không đọc được. Kiểm tra link API trong clb-config.js và quyền truy cập "Bất kỳ ai" của bản triển khai.'), { code: 'BADRESPONSE' });
        }
        if (!data.ok) throw Object.assign(new Error(data.error || 'Có lỗi xảy ra.'), { code: data.code || 'ERROR' });
        return data;
    }
    CLB.get = function (params) {
        if (!CLB.apiConfigured()) return Promise.reject(Object.assign(new Error('Chưa cấu hình link API. Hãy dán link /exec vào file clb-config.js.'), { code: 'CONFIG' }));
        return request(window.CLB_API_URL.trim() + '?' + new URLSearchParams(params).toString());
    };
    CLB.post = function (body) {
        if (!CLB.apiConfigured()) return Promise.reject(Object.assign(new Error('Chưa cấu hình link API. Hãy dán link /exec vào file clb-config.js.'), { code: 'CONFIG' }));
        // Không đặt Content-Type để trình duyệt gửi dạng text/plain (tránh bước kiểm tra CORS của Apps Script)
        return request(window.CLB_API_URL.trim(), { method: 'POST', body: JSON.stringify(body) });
    };

    // ---------- Phiên đăng nhập (chỉ lưu trong tab trình duyệt) ----------
    CLB.session = {
        get(id) { try { const s = JSON.parse(sessionStorage.getItem('clb_token_' + id)); return s && s.exp > Date.now() ? s.token : null; } catch (e) { return null; } },
        set(id, token, exp) { try { sessionStorage.setItem('clb_token_' + id, JSON.stringify({ token, exp })); } catch (e) {} },
        clear(id) { try { sessionStorage.removeItem('clb_token_' + id); } catch (e) {} }
    };

    // ---------- Ảnh đại diện (khung chữ nhật dọc, hiển thị trọn ảnh) ----------
    // Chấp nhận link Drive (file/d/ID, open?id=, uc?id=, thumbnail?id=), chỉ ID, hoặc link ảnh https khác.
    CLB.photoSrc = function (value, width) {
        const t = String(value == null ? '' : value).trim();
        if (!t) return '';
        const m = t.match(/\/d\/([-\w]{20,})/) || t.match(/[?&]id=([-\w]{20,})/);
        if (m) return 'https://drive.google.com/thumbnail?id=' + encodeURIComponent(m[1]) + '&sz=w' + width;
        if (/^[-\w]{20,}$/.test(t)) return 'https://drive.google.com/thumbnail?id=' + encodeURIComponent(t) + '&sz=w' + width;
        if (/^https?:\/\/(?!drive\.google\.com\/drive\/)/i.test(t)) return t;
        return '';
    };
    CLB.initial = function (name) { const last = String(name || '?').trim().split(/\s+/).pop(); return (last.charAt(0) || '?').toUpperCase(); };
    CLB.avatar = function (name, link, width, extraClass) {
        const src = CLB.photoSrc(link, width), initial = CLB.esc(CLB.initial(name)), cls = 'avatar' + (extraClass ? ' ' + extraClass : '');
        if (!src) return `<span class="${cls} avatar-empty">${initial}</span>`;
        return `<img class="${cls}" src="${CLB.esc(src)}" alt="" loading="lazy" referrerpolicy="no-referrer" data-initial="${initial}">`;
    };
    // Ảnh lỗi (link sai, chưa chia sẻ công khai...) -> thay bằng chữ cái đầu của tên
    document.addEventListener('error', function (e) {
        const img = e.target;
        if (img && img.tagName === 'IMG' && img.classList.contains('avatar')) {
            const span = document.createElement('span');
            span.className = img.className + ' avatar-empty';
            span.textContent = img.dataset.initial || '?';
            img.replaceWith(span);
        }
    }, true);

    // ---------- Chương trình học + tiến độ ----------
    CLB.levels = () => Object.keys(window.CHUNG_TRINH_HOC || {});
    CLB.lessons = level => (window.CHUNG_TRINH_HOC || {})[level] || null;

    /**
     * Tách chuỗi "bài A, bài B, ..." thành danh sách. Một số tên bài có chứa dấu phẩy
     * (ví dụ "Ôn tập: Các bài quyền môn phái, Liên đoàn đã học") nên phải đối chiếu với chương trình học
     * thay vì tách mù quáng theo dấu phẩy. Trả về { known: [bài theo thứ tự chương trình], extra: [mục lạ] }.
     */
    CLB.splitLessons = function (text, lessons) {
        let rest = ', ' + String(text || '').trim() + ', ';
        const found = new Set();
        (lessons || []).slice().sort((a, b) => b.length - a.length).forEach(lesson => {
            const token = ', ' + lesson + ', ';
            while (rest.includes(token)) { rest = rest.replace(token, ', '); found.add(lesson); }
        });
        const extra = rest.split(', ').map(s => s.trim()).filter(Boolean);
        return { known: (lessons || []).filter(l => found.has(l)), extra };
    };

    CLB.pctClass = p => (p >= 100 ? 'pct-full' : p > 0 ? 'pct-mid' : 'pct-zero');
    CLB.progressBar = p => `<div class="progress ${CLB.pctClass(p)}" title="${p}%"><div class="progress-fill" style="width:${Math.max(0, Math.min(100, p))}%"></div><span class="progress-text">${p}%</span></div>`;

    // ---------- Truy xuất giá trị theo vai trò cột ----------
    CLB.fieldMap = function (fields) {
        const byRole = {}, byKey = {};
        fields.forEach(f => { byKey[f.key] = f; if (f.role && !byRole[f.role]) byRole[f.role] = f; });
        return { byRole, byKey, fields };
    };
    CLB.val = (map, row, role) => (map.byRole[role] ? row.values[map.byRole[role].key] : '');

    // ---------- Giao diện nhỏ ----------
    CLB.toast = function (message, type) {
        let box = document.getElementById('toastBox');
        if (!box) { box = document.createElement('div'); box.id = 'toastBox'; box.setAttribute('aria-live', 'polite'); document.body.appendChild(box); }
        const el = document.createElement('div');
        el.className = 'toast ' + (type || 'info');
        el.textContent = message;
        box.appendChild(el);
        setTimeout(() => { el.classList.add('hide'); setTimeout(() => el.remove(), 300); }, type === 'error' ? 6000 : 3200);
    };

    const openModals = [];
    CLB.openModal = function (id) {
        const el = document.getElementById(id);
        el.classList.add('open'); el.setAttribute('aria-hidden', 'false');
        openModals.push(id);
        const focusable = el.querySelector('[data-autofocus]');
        if (focusable) setTimeout(() => focusable.focus(), 30);
    };
    CLB.closeModal = function (id) {
        const el = document.getElementById(id);
        el.classList.remove('open'); el.setAttribute('aria-hidden', 'true');
        const i = openModals.lastIndexOf(id); if (i >= 0) openModals.splice(i, 1);
    };
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && openModals.length) CLB.closeModal(openModals[openModals.length - 1]); });
    document.addEventListener('click', e => {
        if (e.target.classList && e.target.classList.contains('modal-overlay')) CLB.closeModal(e.target.id);
        const closer = e.target.closest && e.target.closest('[data-close]');
        if (closer) CLB.closeModal(closer.dataset.close);
    });

    CLB.debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
    CLB.copy = async function (text) {
        try { await navigator.clipboard.writeText(text); return true; } catch (e) {
            const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select();
            let ok = false; try { ok = document.execCommand('copy'); } catch (x) {} ta.remove(); return ok;
        }
    };
})();
