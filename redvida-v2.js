/* Red de Vida V2 — Supabase-backed account, contacts, reviews and admin */
(function () {
  'use strict';
  var cfg = window.RED_VIDA_DB_CONFIG || {};
  var validConfig = typeof cfg.url === 'string' && /^https:\/\/.+\.supabase\.co\/?$/.test(cfg.url) &&
    typeof cfg.publishableKey === 'string' && cfg.publishableKey.length > 20;
  var BUCKET = 'redvida-evidence';
  var db = null, currentUser = null, currentProfile = null, authMode = 'login', cachedResources = [];
  var $ = function (s, root) { return (root || document).querySelector(s); };
  var el = function (tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = String(text);
    return n;
  };
  var errText = function (e) {
    console.error('[Red de Vida V2]', e);
    return e && e.message ? e.message : 'Ocurrió un error. Intenta nuevamente.';
  };
  var message = function (node, text, kind) {
    if (!node) return;
    node.textContent = text || '';
    node.className = 'rv2-message' + (kind ? ' ' + kind : '');
  };
  var dateText = function (value) {
    try { return new Date(value).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' }); }
    catch (_) { return ''; }
  };
  var logEvent = async function (type) {
    if (!db || !currentUser) return;
    try { await db.from('usage_events').insert({ user_id: currentUser.id, event_type: type }); }
    catch (e) { console.warn('No se pudo registrar el evento.', e); }
  };

  function addField(form, labelText, name, type, placeholder, required, maxLength, minLength) {
    var wrap = el('div');
    var label = el('label', 'rv2-label', labelText);
    var input = document.createElement(type === 'textarea' ? 'textarea' : 'input');
    input.className = 'rv2-input' + (type === 'textarea' ? ' rv2-textarea' : '');
    input.name = name;
    input.id = 'rv2-' + name;
    input.placeholder = placeholder || '';
    input.required = !!required;
    if (type !== 'textarea') input.type = type;
    if (maxLength) input.maxLength = maxLength;
    if (minLength) input.minLength = minLength;
    label.htmlFor = input.id;
    wrap.append(label, input);
    form.append(wrap);
    return input;
  }

  function injectSections() {
    var nav = $('.nav-links');
    if (nav && !$('#rv2-account-nav')) {
      var a = el('a', '', 'Mi cuenta'); a.href = '#rv2-account'; a.id = 'rv2-account-nav';
      var b = el('a', '', 'Opiniones'); b.href = '#rv2-reviews';
      nav.append(a, b);
    }
    var header = $('header.site-header');
    if (header && !$('#rv2-account')) {
      var section = el('section', 'rv2-section'); section.id = 'rv2-account';
      section.innerHTML = '<div class="rv2-shell"><div class="rv2-head"><div><div class="rv2-kicker">Tu espacio privado</div><h2>Mi cuenta y mi red de confianza</h2></div><p>Regístrate para administrar tus contactos, consultar tus avisos y compartir tu experiencia con Red de Vida.</p></div><div id="rv2-account-content" class="rv2-card" aria-live="polite"></div></div>';
      header.after(section);
    }
    var help = $('#orientacion');
    if (help && !$('#rv2-resources')) {
      var resources = el('section', 'rv2-section'); resources.id = 'rv2-resources';
      resources.innerHTML = '<div class="rv2-shell"><div class="rv2-head"><div><div class="rv2-kicker">Directorio administrable</div><h2>Recursos de apoyo</h2></div><p>Recursos adicionales publicados por administradores. La información debe verificarse antes de hacerse visible.</p></div><select id="rv2-resource-filter" class="rv2-input rv2-resource-filter" aria-label="Filtrar recursos por categoría"><option value="">Todas las categorías</option></select><div id="rv2-resource-list" class="rv2-resource-grid"><div class="rv2-empty">Cargando recursos…</div></div></div>';
      help.after(resources);
    }
    var footer = $('footer.footer');
    if (footer && !$('#rv2-reviews')) {
      var reviews = el('section', 'rv2-section'); reviews.id = 'rv2-reviews';
      reviews.innerHTML = '<div class="rv2-shell"><div class="rv2-head"><div><div class="rv2-kicker">Experiencias reales</div><h2>Opiniones de la comunidad</h2></div><p>Las reseñas solo aparecen después de ser aprobadas y cuando su autor autoriza su publicación.</p></div><div id="rv2-public-review-stats" class="rv2-review-stats"></div><div id="rv2-public-reviews" class="rv2-review-grid"><div class="rv2-empty">Cargando opiniones aprobadas…</div></div><div id="rv2-community-audio" class="rv2-audio-section" aria-live="polite"></div><p class="rv2-note">No publiques documentos, conversaciones, números telefónicos ni información sensible en las evidencias.</p></div>';
      footer.before(reviews);
    }
    var tech = $('#ficha-tecnica .shell');
    if (tech && !$('#rv2-tech-note')) {
      var note = el('p', 'rv2-note', 'Las funciones de cuenta y evidencias requieren el esquema SQL V2 en Supabase. La Inteligencia Artificial se plantea como una mejora futura y no se presenta como integrada.');
      note.id = 'rv2-tech-note'; tech.append(note);
    }
  }

  function renderAuth() {
    var host = $('#rv2-account-content');
    if (!host) return;
    host.replaceChildren();
    var layout = el('div', 'rv2-auth-layout');
    var side = el('div', 'rv2-auth-side');
    var copy = el('div');
    copy.append(el('span', 'rv2-tag', 'RED DE VIDA'), el('h3', '', 'Una red de apoyo más cerca.'), el('p', '', 'Tu cuenta te permite mantener organizada tu red de confianza y gestionar tus valoraciones.'));
    side.append(copy, el('small', '', 'Tus contactos son privados y están asociados a tu cuenta.'));
    var card = el('div', 'rv2-card');
    card.append(el('h3', '', authMode === 'login' ? 'Iniciar sesión' : 'Crear una cuenta'));
    card.append(el('p', 'rv2-muted', authMode === 'login' ? 'Ingresa para consultar tu espacio privado.' : 'Regístrate con tu correo y crea una contraseña segura.'));
    var form = el('form', 'rv2-auth-form'); form.id = 'rv2-auth-form';
    if (authMode === 'signup') addField(form, 'Nombre para mostrar', 'display_name', 'text', 'Tu nombre', true, 70);
    addField(form, 'Correo electrónico', 'email', 'email', 'nombre@correo.com', true, 254);
    addField(form, 'Contraseña', 'password', 'password', 'Mínimo 8 caracteres', true, 128, 8);
    var buttons = el('div', 'rv2-buttons');
    var submit = el('button', 'rv2-btn', authMode === 'login' ? 'Ingresar' : 'Crear cuenta');
    submit.type = 'submit';
    var toggle = el('button', 'rv2-btn secondary', authMode === 'login' ? 'Crear una cuenta' : 'Ya tengo una cuenta');
    toggle.type = 'button';
    toggle.addEventListener('click', function () { authMode = authMode === 'login' ? 'signup' : 'login'; renderAuth(); });
    buttons.append(submit, toggle);
    var status = el('p', 'rv2-message'); status.id = 'rv2-auth-message';
    form.append(buttons, status);
    form.addEventListener('submit', function (event) { handleAuth(event, submit, status); });
    card.append(form); layout.append(side, card); host.append(layout);
    if (!validConfig) message(status, 'Falta configurar Supabase en database-config.js.', 'error');
  }

  async function handleAuth(event, button, status) {
    event.preventDefault();
    if (!db) return message(status, 'Supabase no está configurado.', 'error');
    var data = new FormData(event.currentTarget);
    var email = String(data.get('email') || '').trim().toLowerCase();
    var password = String(data.get('password') || '');
    button.disabled = true;
    message(status, authMode === 'login' ? 'Iniciando sesión…' : 'Creando cuenta…');
    try {
      if (authMode === 'signup') {
        var displayName = String(data.get('display_name') || '').trim();
        var signUp = await db.auth.signUp({ email: email, password: password, options: { data: { display_name: displayName } } });
        if (signUp.error) throw signUp.error;
        if (signUp.data.session) {
          currentUser = signUp.data.user;
          await logEvent('login');
          await renderDashboard();
        } else {
          message(status, 'Cuenta creada. Revisa tu correo para confirmar el registro y luego inicia sesión.', 'success');
        }
      } else {
        var login = await db.auth.signInWithPassword({ email: email, password: password });
        if (login.error) throw login.error;
        currentUser = login.data.user;
        await logEvent('login');
        await renderDashboard();
      }
    } catch (e) { message(status, errText(e), 'error'); }
    finally { button.disabled = false; }
  }

  async function renderDashboard() {
    if (!db || !currentUser) return renderAuth();
    var host = $('#rv2-account-content');
    if (!host) return;
    host.replaceChildren(el('p', 'rv2-message', 'Cargando tu espacio…'));
    var result = await db.from('profiles').select('display_name,role').eq('id', currentUser.id).maybeSingle();
    if (result.error) {
      host.replaceChildren(el('p', 'rv2-message error', 'No se pudo cargar el perfil: ' + errText(result.error) + '. Ejecuta primero el SQL V2 en Supabase.'));
      return;
    }
    currentProfile = result.data || { display_name: currentUser.email ? currentUser.email.split('@')[0] : 'Usuario', role: 'user' };
    var wrap = el('div', 'rv2-dashboard');
    var bar = el('div', 'rv2-userbar');
    var identity = el('div');
    identity.append(el('strong', '', 'Hola, ' + (currentProfile.display_name || 'usuario')), el('div', 'rv2-message', currentUser.email || ''));
    var logout = el('button', 'rv2-btn secondary', 'Cerrar sesión');
    logout.addEventListener('click', async function () {
      var result = await db.auth.signOut();
      if (result.error) alert(errText(result.error));
    });
    bar.append(identity, logout);
    var grid = el('div', 'rv2-grid');
    grid.append(buildContactsCard(), buildNotificationCard());
    wrap.append(bar, grid, buildReviewFormCard(), buildMyReviewsCard());
    if (currentProfile.role === 'admin') wrap.append(buildAdminCard());
    host.replaceChildren(wrap);
    await Promise.all([loadContacts(), loadNotifications(), loadMyReviews()]);
  }

  function buildContactsCard() {
    var card = el('div', 'rv2-card');
    card.append(el('h3', '', 'Mis contactos de confianza'), el('p', 'rv2-muted', 'Solo tú puedes consultar y administrar los contactos de tu cuenta.'));
    var form = el('form', 'rv2-inline-form'); form.id = 'rv2-contact-form';
    addField(form, 'Nombre', 'name', 'text', 'Nombre del contacto', true, 80);
    addField(form, 'Teléfono', 'phone', 'tel', 'Número de contacto', true, 30);
    addField(form, 'Relación', 'relationship', 'text', 'Familia, amistad…', true, 40);
    var actions = el('div', 'rv2-buttons wide');
    var submit = el('button', 'rv2-btn', 'Guardar contacto'); submit.type = 'submit'; actions.append(submit);
    var status = el('p', 'rv2-message wide'); status.id = 'rv2-contact-message';
    form.append(actions, status); form.addEventListener('submit', handleAddContact);
    var list = el('div', 'rv2-list'); list.id = 'rv2-contacts-list'; list.append(el('div', 'rv2-empty', 'Cargando contactos…'));
    card.append(form, list); return card;
  }

  async function loadContacts() {
    var host = $('#rv2-contacts-list'); if (!host || !currentUser) return;
    var result = await db.from('trusted_contacts').select('id,name,phone,relationship,created_at')
      .eq('user_id', currentUser.id).order('created_at', { ascending: false });
    if (result.error) return host.replaceChildren(el('p', 'rv2-message error', errText(result.error)));
    host.replaceChildren();
    if (!result.data || !result.data.length) host.append(el('div', 'rv2-empty', 'Aún no has agregado contactos.'));
    (result.data || []).forEach(function (contact) {
      var row = el('div', 'rv2-list-item');
      var info = el('div');
      info.append(el('strong', '', contact.name), el('small', '', contact.relationship + ' · ' + contact.phone));
      var actions = el('div', 'rv2-item-actions');
      var edit = el('button', 'rv2-mini-btn', 'Editar'); edit.addEventListener('click', async function () {
        var name = prompt('Nombre del contacto:', contact.name); if (name === null) return;
        var phone = prompt('Teléfono:', contact.phone); if (phone === null) return;
        var relationship = prompt('Relación:', contact.relationship); if (relationship === null) return;
        if (!name.trim() || !phone.trim() || !relationship.trim()) return alert('Completa todos los datos.');
        var updated = await db.from('trusted_contacts').update({ name: name.trim(), phone: phone.trim(), relationship: relationship.trim() })
          .eq('id', contact.id).eq('user_id', currentUser.id);
        if (updated.error) alert(errText(updated.error)); else await loadContacts();
      });
      var remove = el('button', 'rv2-mini-btn danger', 'Eliminar'); remove.addEventListener('click', async function () {
        if (!confirm('¿Eliminar el contacto ' + contact.name + '?')) return;
        var deleted = await db.from('trusted_contacts').delete().eq('id', contact.id).eq('user_id', currentUser.id);
        if (deleted.error) alert(errText(deleted.error));
        else {
          await db.from('notifications').insert({ user_id: currentUser.id, title: 'Contacto eliminado', body: 'Se actualizó tu red de confianza.' });
          await loadContacts(); await Promise.all([loadNotifications(), logEvent('contact_deleted')]);
        }
      });
      actions.append(edit, remove); row.append(info, actions); host.append(row);
    });
  }

  async function handleAddContact(event) {
    event.preventDefault();
    var form = event.currentTarget, status = $('#rv2-contact-message');
    var data = new FormData(form);
    var record = {
      user_id: currentUser.id,
      name: String(data.get('name') || '').trim(),
      phone: String(data.get('phone') || '').trim(),
      relationship: String(data.get('relationship') || '').trim()
    };
    if (!record.name || !record.phone || !record.relationship) return message(status, 'Completa todos los campos.', 'error');
    var result = await db.from('trusted_contacts').insert(record);
    if (result.error) return message(status, errText(result.error), 'error');
    form.reset(); message(status, 'Contacto guardado correctamente.', 'success');
    await db.from('notifications').insert({ user_id: currentUser.id, title: 'Contacto agregado', body: 'Se guardó un nuevo contacto en tu red de confianza.' });
    await Promise.all([loadContacts(), loadNotifications(), logEvent('contact_created')]);
  }

  function buildNotificationCard() {
    var card = el('div', 'rv2-card');
    var bar = el('div', 'rv2-userbar'); bar.append(el('h3', '', 'Mis notificaciones'));
    var mark = el('button', 'rv2-mini-btn', 'Marcar leídas'); mark.addEventListener('click', markNotificationsRead); bar.append(mark);
    var list = el('div', 'rv2-list'); list.id = 'rv2-notifications-list'; list.append(el('div', 'rv2-empty', 'Cargando notificaciones…'));
    card.append(bar, list); return card;
  }
  async function loadNotifications() {
    var host = $('#rv2-notifications-list'); if (!host) return;
    var result = await db.from('notifications').select('id,title,body,is_read,created_at')
      .eq('user_id', currentUser.id).order('created_at', { ascending: false }).limit(20);
    if (result.error) return host.replaceChildren(el('p', 'rv2-message error', errText(result.error)));
    host.replaceChildren();
    if (!result.data || !result.data.length) return host.append(el('div', 'rv2-empty', 'No tienes notificaciones todavía.'));
    result.data.forEach(function (item) {
      var row = el('div', 'rv2-list-item'), info = el('div');
      info.append(el('strong', '', (item.is_read ? '✓ ' : '● ') + item.title),
        el('small', '', item.body + ' · ' + dateText(item.created_at)));
      row.append(info); host.append(row);
    });
  }
  async function markNotificationsRead() {
    var result = await db.from('notifications').update({ is_read: true }).eq('user_id', currentUser.id).eq('is_read', false);
    if (result.error) alert(errText(result.error)); else await loadNotifications();
  }

  function buildReviewFormCard() {
    var card = el('div', 'rv2-card');
    card.append(el('h3', '', 'Comparte tu experiencia'),
      el('p', 'rv2-muted', 'Tu reseña se revisará antes de publicarse. Adjunta una captura sin datos personales ni conversaciones privadas.'));
    var form = el('form', 'rv2-review-form'); form.id = 'rv2-review-form';
    var rateWrap = el('div'); rateWrap.append(el('label', 'rv2-label', 'Calificación'));
    var rating = document.createElement('select'); rating.className = 'rv2-input'; rating.name = 'rating'; rating.required = true;
    [['','Selecciona estrellas'],['5','★★★★★ · 5'],['4','★★★★☆ · 4'],['3','★★★☆☆ · 3'],['2','★★☆☆☆ · 2'],['1','★☆☆☆☆ · 1']].forEach(function (item) {
      var option = document.createElement('option'); option.value = item[0]; option.textContent = item[1]; rating.append(option);
    });
    rateWrap.append(rating);
    form.append(rateWrap);
    var commentWrap = el('div'); commentWrap.append(el('label', 'rv2-label', 'Comentario'));
    var comment = document.createElement('textarea'); comment.className = 'rv2-input rv2-textarea'; comment.name = 'comment';
    comment.minLength = 5; comment.maxLength = 1200; comment.required = true; comment.placeholder = 'Cuéntanos qué te pareció Red de Vida…';
    commentWrap.append(comment); form.append(commentWrap);
    var fileWrap = el('div'); fileWrap.append(el('label', 'rv2-label', 'Evidencia opcional (JPG, PNG o WebP; máximo 5 MB)'));
    var file = document.createElement('input'); file.className = 'rv2-input'; file.type = 'file'; file.name = 'evidence';
    file.accept = 'image/jpeg,image/png,image/webp'; fileWrap.append(file); form.append(fileWrap);
    var consent = document.createElement('label'); consent.className = 'rv2-check';
    var check = document.createElement('input'); check.type = 'checkbox'; check.name = 'allow_public';
    consent.append(check, document.createTextNode('Autorizo que mi comentario y evidencia adjunta se muestren públicamente si la reseña es aprobada. No incluiré datos personales.'));
    form.append(consent);
    var submit = el('button', 'rv2-btn', 'Enviar reseña para revisión'); submit.type = 'submit';
    var status = el('p', 'rv2-message'); status.id = 'rv2-review-message';
    form.append(submit, status); form.addEventListener('submit', handleReviewSubmit);
    card.append(form); return card;
  }

  async function handleReviewSubmit(event) {
    event.preventDefault();
    var form = event.currentTarget, data = new FormData(form);
    var status = $('#rv2-review-message'), submit = form.querySelector('button[type="submit"]');
    var rating = Number(data.get('rating')), comment = String(data.get('comment') || '').trim();
    var file = data.get('evidence'), allowPublic = data.get('allow_public') === 'on';
    if (!Number.isInteger(rating) || rating < 1 || rating > 5 || comment.length < 5)
      return message(status, 'Selecciona una calificación y escribe un comentario de al menos 5 caracteres.', 'error');
    var evidencePath = null; submit.disabled = true; message(status, 'Enviando reseña…');
    try {
      if (file && file.size) {
        if (['image/jpeg','image/png','image/webp'].indexOf(file.type) === -1 || file.size > 5 * 1024 * 1024)
          throw new Error('La evidencia debe ser JPG, PNG o WebP y pesar máximo 5 MB.');
        var ext = file.type === 'image/jpeg' ? 'jpg' : file.type.split('/')[1];
        evidencePath = currentUser.id + '/' + crypto.randomUUID() + '.' + ext;
        var upload = await db.storage.from(BUCKET).upload(evidencePath, file, { contentType: file.type, upsert: false });
        if (upload.error) throw upload.error;
      }
      var insert = await db.from('reviews').insert({
        user_id: currentUser.id, rating: rating, comment: comment,
        evidence_path: evidencePath, allow_public: allowPublic, status: 'pending'
      });
      if (insert.error) {
        if (evidencePath) await db.storage.from(BUCKET).remove([evidencePath]);
        throw insert.error;
      }
      await logEvent('review_submitted');
      form.reset(); message(status, '¡Gracias! Tu reseña quedó pendiente de aprobación.', 'success');
      await db.from('notifications').insert({ user_id: currentUser.id, title: 'Reseña recibida', body: 'Tu opinión fue enviada y está pendiente de revisión.' });
      await Promise.all([loadMyReviews(), loadNotifications(), loadPublicReviews()]);
    } catch (e) { message(status, errText(e), 'error'); }
    finally { submit.disabled = false; }
  }

  function buildMyReviewsCard() {
    var card = el('div', 'rv2-card');
    card.append(el('h3', '', 'Mis reseñas'), el('p', 'rv2-muted', 'Consulta el estado de tus opiniones.'));
    var list = el('div', 'rv2-list'); list.id = 'rv2-my-reviews';
    list.append(el('div', 'rv2-empty', 'Cargando reseñas…')); card.append(list); return card;
  }
  async function loadMyReviews() {
    var host = $('#rv2-my-reviews'); if (!host) return;
    var result = await db.from('reviews').select('id,rating,comment,status,created_at,allow_public')
      .eq('user_id', currentUser.id).order('created_at', { ascending: false });
    if (result.error) return host.replaceChildren(el('p', 'rv2-message error', errText(result.error)));
    host.replaceChildren();
    if (!result.data || !result.data.length) return host.append(el('div', 'rv2-empty', 'Todavía no has enviado reseñas.'));
    result.data.forEach(function (item) {
      var text = item.status === 'approved' ? 'Aprobada' : (item.status === 'rejected' ? 'No aprobada' : 'Pendiente de revisión');
      var row = el('div', 'rv2-list-item'), info = el('div');
      info.append(el('strong', '', '★'.repeat(item.rating) + '☆'.repeat(5-item.rating) + ' · ' + text),
        el('small', '', item.comment.slice(0, 180) + (item.comment.length > 180 ? '…' : '') + ' · ' + dateText(item.created_at) + ' · ' + (item.allow_public ? 'Autorizada para publicación' : 'Privada')));
      row.append(info, el('span', 'rv2-tag', text)); host.append(row);
    });
  }

  function buildAdminCard() {
    var card = el('div', 'rv2-card rv2-admin'); card.id = 'rv2-admin-panel';
    card.append(el('h3', '', 'Panel de administración'),
      el('p', 'rv2-muted', 'Solo las cuentas con rol de administrador pueden aprobar reseñas y administrar recursos.'));
    var stats = el('div', 'rv2-admin-grid'); stats.id = 'rv2-admin-stats';
    stats.append(el('div', 'rv2-empty', 'Cargando estadísticas…'));
    var users = el('div', 'rv2-list'); users.id = 'rv2-admin-users';
    users.append(el('div', 'rv2-empty', 'Cargando usuarios…'));
    var pending = el('div', 'rv2-list'); pending.id = 'rv2-pending-reviews';
    pending.append(el('div', 'rv2-empty', 'Cargando reseñas pendientes…'));
    var adminResources = el('div', 'rv2-list'); adminResources.id = 'rv2-admin-resources';
    adminResources.append(el('div', 'rv2-empty', 'Cargando recursos…'));
    var resourceCard = buildAdminResourceForm();
    card.append(stats, el('h3', '', 'Usuarios registrados'), users, el('h3', '', 'Reseñas pendientes'), pending,
      el('h3', '', 'Administrar recursos publicados'), adminResources, resourceCard);
    setTimeout(loadAdminData, 0); return card;
  }
  function buildAdminResourceForm() {
    var card = el('div', 'rv2-card'); card.style.marginTop = '14px';
    card.append(el('h3', '', 'Agregar recurso de apoyo'));
    var form = el('form', 'rv2-inline-form'); form.id = 'rv2-resource-form';
    addField(form, 'Nombre oficial', 'title', 'text', 'Nombre del recurso', true, 120);
    addField(form, 'Categoría', 'category', 'text', 'Salud mental, emergencia…', true, 60);
    addField(form, 'Descripción', 'description', 'text', 'Descripción verificada', true, 500);
    addField(form, 'Enlace telefónico tel:', 'phone_href', 'text', 'tel:123', false, 50);
    addField(form, 'Sitio web HTTPS', 'website_url', 'url', 'https://…', false, 300);
    var actions = el('div', 'rv2-buttons wide'), submit = el('button', 'rv2-btn', 'Publicar recurso');
    submit.type = 'submit'; actions.append(submit);
    var status = el('p', 'rv2-message wide'); status.id = 'rv2-resource-message';
    form.append(actions, status); form.addEventListener('submit', handleResourceSubmit);
    card.append(form); return card;
  }
  async function loadAdminData() {
    var statsHost = $('#rv2-admin-stats'), pendingHost = $('#rv2-pending-reviews');
    if (!statsHost || !pendingHost) return;
    var statsResult = await db.rpc('redvida_admin_stats');
    statsHost.replaceChildren();
    if (statsResult.error) statsHost.append(el('p', 'rv2-message error', errText(statsResult.error)));
    else {
      var stats = statsResult.data || {};
      [['Usuarios',stats.users],['Contactos',stats.contacts],['Reseñas',stats.reviews],
        ['Pendientes',stats.pending_reviews],['Aprobadas públicas',stats.approved_reviews],
        ['Promedio',stats.average_rating],['Eventos',stats.usage_events]].forEach(function (item) {
          var box = el('div', 'rv2-admin-stat');
          box.append(el('strong', '', String(item[1] === undefined ? 0 : item[1])), el('span', '', item[0]));
          statsHost.append(box);
        });
    }
    var usersHost = $('#rv2-admin-users');
    if (usersHost) {
      var usersResult = await db.from('profiles').select('id,display_name,role,created_at').order('created_at', { ascending: false }).limit(100);
      usersHost.replaceChildren();
      if (usersResult.error) usersHost.append(el('p', 'rv2-message error', errText(usersResult.error)));
      else if (!usersResult.data || !usersResult.data.length) usersHost.append(el('div', 'rv2-empty', 'No hay perfiles registrados.'));
      else usersResult.data.forEach(function (profile) {
        var row = el('div', 'rv2-list-item'), info = el('div');
        info.append(el('strong', '', profile.display_name || 'Usuario'), el('small', '', 'Cuenta ' + profile.role + ' · ' + dateText(profile.created_at)));
        row.append(info, el('span', 'rv2-tag', profile.role)); usersHost.append(row);
      });
    }
    await loadManagedResources();
    var result = await db.from('reviews').select('id,user_id,rating,comment,evidence_path,allow_public,created_at')
      .eq('status', 'pending').order('created_at', { ascending: true }).limit(50);
    pendingHost.replaceChildren();
    if (result.error) return pendingHost.append(el('p', 'rv2-message error', errText(result.error)));
    if (!result.data || !result.data.length) pendingHost.append(el('div', 'rv2-empty', 'No hay reseñas pendientes.'));
    for (var i = 0; i < (result.data || []).length; i++) {
      var review = result.data[i];
      var row = el('div', 'rv2-list-item'), info = el('div'), actions = el('div', 'rv2-item-actions');
      info.append(el('strong', '', '★'.repeat(review.rating) + '☆'.repeat(5-review.rating) + ' · ' + (review.allow_public ? 'Solicita publicación' : 'Privada')),
        el('small', '', review.comment + ' · ' + dateText(review.created_at)));
      if (review.evidence_path) {
        var signed = await db.storage.from(BUCKET).createSignedUrl(review.evidence_path, 900);
        if (signed.data && signed.data.signedUrl) {
          var link = el('a', '', 'Ver evidencia'); link.href = signed.data.signedUrl; link.target = '_blank'; link.rel = 'noopener noreferrer'; info.append(link);
        }
      }
      var approve = el('button', 'rv2-mini-btn', 'Aprobar');
      approve.addEventListener('click', function (item) { return function () { moderateReview(item, 'approved'); }; }(review));
      var reject = el('button', 'rv2-mini-btn danger', 'Rechazar');
      reject.addEventListener('click', function (item) { return function () { moderateReview(item, 'rejected'); }; }(review));
      actions.append(approve, reject); row.append(info, actions); pendingHost.append(row);
    }
  }
  async function moderateReview(review, status) {
    if (!confirm('¿Deseas ' + (status === 'approved' ? 'aprobar' : 'rechazar') + ' esta reseña?')) return;
    var result = await db.from('reviews').update({
      status: status, moderated_at: new Date().toISOString(), moderated_by: currentUser.id
    }).eq('id', review.id);
    if (result.error) return alert(errText(result.error));
    await db.from('notifications').insert({
      user_id: review.user_id, title: status === 'approved' ? 'Reseña aprobada' : 'Reseña no aprobada',
      body: status === 'approved'
        ? (review.allow_public ? 'Tu reseña fue aprobada para mostrarse públicamente.' : 'Tu reseña fue aprobada y permanece privada.')
        : 'Tu reseña no fue aprobada para publicación.'
    });
    await Promise.all([loadAdminData(), loadPublicReviews()]);
  }
  async function handleResourceSubmit(event) {
    event.preventDefault();
    var form = event.currentTarget, data = new FormData(form), status = $('#rv2-resource-message');
    var phone = String(data.get('phone_href') || '').trim() || null;
    var website = String(data.get('website_url') || '').trim() || null;
    if (phone && !/^tel:[0-9+() -]+$/.test(phone)) return message(status, 'El teléfono debe comenzar por tel: y contener números o símbolos telefónicos.', 'error');
    if (website && !/^https:\/\//i.test(website)) return message(status, 'El sitio web debe comenzar por https://.', 'error');
    var result = await db.from('support_resources').insert({
      title: String(data.get('title') || '').trim(), category: String(data.get('category') || '').trim(),
      description: String(data.get('description') || '').trim(), phone_href: phone,
      website_url: website, created_by: currentUser.id, is_active: true
    });
    if (result.error) return message(status, errText(result.error), 'error');
    form.reset(); message(status, 'Recurso publicado.', 'success');
    await Promise.all([loadResources(), loadAdminData()]);
  }

  async function loadManagedResources() {
    var host = $('#rv2-admin-resources'); if (!host) return;
    var result = await db.from('support_resources').select('id,title,category,is_active,created_at').order('created_at', { ascending: false });
    host.replaceChildren();
    if (result.error) return host.append(el('p', 'rv2-message error', errText(result.error)));
    if (!result.data || !result.data.length) return host.append(el('div', 'rv2-empty', 'Todavía no hay recursos administrados.'));
    result.data.forEach(function (item) {
      var row = el('div', 'rv2-list-item'), info = el('div');
      info.append(el('strong', '', item.title), el('small', '', item.category + ' · ' + (item.is_active ? 'Publicado' : 'Oculto')));
      var actions = el('div', 'rv2-item-actions');
      var toggle = el('button', 'rv2-mini-btn', item.is_active ? 'Ocultar' : 'Publicar');
      toggle.addEventListener('click', async function () {
        var changed = await db.from('support_resources').update({ is_active: !item.is_active }).eq('id', item.id);
        if (changed.error) alert(errText(changed.error)); else { await loadManagedResources(); await loadResources(); }
      });
      var remove = el('button', 'rv2-mini-btn danger', 'Eliminar');
      remove.addEventListener('click', async function () {
        if (!confirm('¿Eliminar el recurso ' + item.title + '?')) return;
        var deleted = await db.from('support_resources').delete().eq('id', item.id);
        if (deleted.error) alert(errText(deleted.error)); else { await loadManagedResources(); await loadResources(); }
      });
      actions.append(toggle, remove); row.append(info, actions); host.append(row);
    });
  }

  async function loadResources() {
    var host = $('#rv2-resource-list'); if (!host || !db) return;
    var result = await db.from('support_resources').select('id,title,category,description,phone_label,phone_href,website_url')
      .eq('is_active', true).order('display_order', { ascending: true });
    if (result.error) { host.replaceChildren(el('div', 'rv2-empty', 'No se pudieron cargar recursos: ' + errText(result.error))); return; }
    cachedResources = result.data || [];
    var filter = $('#rv2-resource-filter');
    if (filter) {
      var selected = filter.value;
      filter.replaceChildren();
      var all = document.createElement('option'); all.value = ''; all.textContent = 'Todas las categorías'; filter.append(all);
      Array.from(new Set(cachedResources.map(function (item) { return item.category; }))).sort().forEach(function (category) {
        var option = document.createElement('option'); option.value = category; option.textContent = category; filter.append(option);
      });
      filter.value = selected;
      filter.onchange = renderResources;
    }
    renderResources();
  }
  function renderResources() {
    var host = $('#rv2-resource-list'); if (!host) return;
    var filter = $('#rv2-resource-filter');
    var category = filter ? filter.value : '';
    var items = cachedResources.filter(function (item) { return !category || item.category === category; });
    host.replaceChildren();
    if (!items.length) return host.append(el('div', 'rv2-empty', 'No hay recursos en esta categoría. Los canales principales están en la sección anterior.'));
    items.forEach(function (item) {
      var card = el('article', 'rv2-resource');
      card.append(el('span', 'rv2-tag', item.category), el('h3', '', item.title), el('p', '', item.description));
      if (item.phone_href) { var phone = el('a', '', item.phone_label || 'Llamar'); phone.href = item.phone_href; phone.addEventListener('click', function () { logEvent('resource_opened'); }); card.append(phone); }
      if (item.website_url) { var web = el('a', '', 'Consultar sitio oficial ↗'); web.href = item.website_url; web.target = '_blank'; web.rel = 'noopener noreferrer'; web.addEventListener('click', function () { logEvent('resource_opened'); }); card.append(web); }
      host.append(card);
    });
  }
  async function loadCommunityAudio() {
    var host = $('#rv2-community-audio');
    if (!host) return;
    var recordings = [
      { name: 'Samuel', duration: '00:48', src: './audios/samuel.mp3' },
      { name: 'Juanes', duration: '02:24', src: './audios/juanes.mp3' }
    ];
    var available = await Promise.all(recordings.map(async function (item) {
      try {
        var response = await fetch(item.src, { method: 'HEAD', cache: 'no-store' });
        return response.ok ? item : null;
      } catch (_) { return null; }
    }));
    available = available.filter(Boolean);
    if (!available.length) return;
    var heading = el('div', 'rv2-audio-heading');
    heading.append(el('h3', '', 'Voces de la comunidad'),
      el('p', '', 'Escucha los mensajes de voz compartidos para Red de Vida.'));
    var grid = el('div', 'rv2-audio-grid');
    available.forEach(function (item, index) {
      var card = el('article', 'rv2-audio-card');
      var top = el('div', 'rv2-audio-card-top');
      top.append(el('span', 'rv2-tag', 'Audio ' + String(index + 1).padStart(2, '0')),
        el('span', 'rv2-audio-duration', item.duration));
      card.append(top, el('h4', '', 'Mensaje de ' + item.name));
      var player = document.createElement('audio');
      player.controls = true;
      player.preload = 'none';
      player.src = item.src;
      player.setAttribute('aria-label', 'Reproducir mensaje de ' + item.name);
      card.append(player);
      grid.append(card);
    });
    host.replaceChildren(heading, grid);
  }

  async function loadPublicReviews() {
    var host = $('#rv2-public-reviews'), statsHost = $('#rv2-public-review-stats');
    if (!host || !statsHost || !db) return;
    var result = await db.from('reviews').select('id,rating,comment,evidence_path,created_at')
      .eq('status', 'approved').eq('allow_public', true).order('created_at', { ascending: false }).limit(1000);
    host.replaceChildren(); statsHost.replaceChildren();
    if (result.error) return host.append(el('div', 'rv2-empty', 'No se pudieron cargar opiniones: ' + errText(result.error)));
    var items = result.data || [], count = items.length;
    var average = count ? (items.reduce(function (sum, item) { return sum + item.rating; }, 0) / count).toFixed(1) : '—';
    [[average, 'Calificación promedio'], [String(count), 'Opiniones aprobadas']].forEach(function (item) {
      var box = el('div', 'rv2-stat'); box.append(el('strong', '', item[0]), el('span', '', item[1])); statsHost.append(box);
    });
    if (!count) return host.append(el('div', 'rv2-empty', 'Aún no hay opiniones aprobadas para publicación.'));
    for (var i = 0; i < Math.min(items.length, 30); i++) {
      var item = items[i], card = el('article', 'rv2-review-card');
      card.append(el('div', 'rv2-stars', '★'.repeat(item.rating) + '☆'.repeat(5-item.rating)),
        el('p', '', item.comment), el('small', '', 'Usuario de Red de Vida · ' + dateText(item.created_at)));
      if (item.evidence_path) {
        var signed = await db.storage.from(BUCKET).createSignedUrl(item.evidence_path, 900);
        if (signed.data && signed.data.signedUrl) {
          var img = document.createElement('img'); img.src = signed.data.signedUrl;
          img.alt = 'Evidencia compartida con autorización'; img.loading = 'lazy'; card.append(img);
        }
      }
      host.append(card);
    }
  }

  async function start() {
    injectSections();
    loadCommunityAudio();
    if (!validConfig || !window.supabase || !window.supabase.createClient) {
      renderAuth();
      var resources = $('#rv2-resource-list'), reviews = $('#rv2-public-reviews');
      if (resources) resources.replaceChildren(el('div', 'rv2-empty', 'Configura Supabase para habilitar el directorio.'));
      if (reviews) reviews.replaceChildren(el('div', 'rv2-empty', 'Las opiniones estarán disponibles después de configurar Supabase V2.'));
      return;
    }
    db = window.supabase.createClient(cfg.url.trim(), cfg.publishableKey.trim(), {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });
    await Promise.all([loadResources(), loadPublicReviews()]);
    var sessionResult = await db.auth.getSession();
    currentUser = sessionResult.data && sessionResult.data.session ? sessionResult.data.session.user : null;
    if (currentUser) await renderDashboard(); else renderAuth();
    db.auth.onAuthStateChange(function (_event, session) {
      currentUser = session ? session.user : null;
      setTimeout(function () { if (currentUser) renderDashboard(); else renderAuth(); }, 0);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();