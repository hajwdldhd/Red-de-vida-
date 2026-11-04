/* Red de Vida: conexión con Supabase */
(() => {
  const cfg = window.RED_VIDA_DB_CONFIG || {};

  const valid = typeof cfg.url === 'string'
    && /^https:\/\/.+\.supabase\.co\/?$/.test(cfg.url.trim())
    && typeof cfg.publishableKey === 'string'
    && cfg.publishableKey.trim().length > 20
    && !cfg.url.includes('PEGA_AQUI')
    && !cfg.publishableKey.includes('PEGA_AQUI');

  const make = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = String(text);
    return n;
  };

  function addFeedbackForm() {
    if (document.getElementById('prototype-feedback-form')) return;

    const footer = document.querySelector('footer.footer');
    if (!footer) return;

    const section = make('section', 'content-section');
    section.id = 'opinion-prototipo';

    section.innerHTML = `
      <div class="shell">
        <div class="section-head">
          <div>
            <div class="eyebrow">Validación académica</div>
            <h2>¿Cómo fue tu experiencia?</h2>
          </div>
          <p>Tu valoración ayuda a mejorar el prototipo.
          Solo guardamos una calificación y una categoría general.
          No escribas nombres ni teléfonos.</p>
        </div>

        <form id="prototype-feedback-form"
          style="max-width:620px;display:grid;gap:11px;padding:22px;
          border:1px solid var(--line);border-radius:18px;
          background:var(--paper)">

          <label for="feedback-rating">
            ¿Qué tan clara te pareció la página?
          </label>

          <select id="feedback-rating" class="field" required>
            <option value="">Selecciona una calificación</option>
            <option value="1">1 · Nada clara</option>
            <option value="2">2 · Poco clara</option>
            <option value="3">3 · Más o menos</option>
            <option value="4">4 · Clara</option>
            <option value="5">5 · Muy clara</option>
          </select>

          <label for="feedback-category">
            ¿Qué destacarías?
          </label>

          <select id="feedback-category" class="field" required>
            <option value="">Selecciona una opción</option>
            <option value="useful">La página me parece útil</option>
            <option value="clear">La información es clara</option>
            <option value="confusing">Hay partes confusas</option>
            <option value="improvement">Veo oportunidades de mejora</option>
          </select>

          <button class="btn btn-primary"
            type="submit" id="send-feedback">
            Enviar valoración
          </button>

          <p id="feedback-status" role="status"
            aria-live="polite"></p>
        </form>
      </div>`;

    footer.before(section);
  }

  function status(message) {
    const node = document.getElementById('feedback-status');
    if (node) node.textContent = message;
  }

  function safeLink(label, href, cls) {
    if (!href || !/^(tel:|https:\/\/)/i.test(href)) return null;

    const a = make('a', cls, label);
    a.href = href;

    if (/^https:\/\//i.test(href)) {
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
    }

    return a;
  }

  async function start() {
    addFeedbackForm();

    if (!valid || !window.supabase?.createClient) {
      status('La conexión con Supabase está pendiente de configuración.');
      return;
    }

    const db = window.supabase.createClient(
      cfg.url.trim(),
      cfg.publishableKey.trim()
    );

    const form = document.getElementById('prototype-feedback-form');

    if (form) {
      form.addEventListener('submit', async (event) => {
        event.preventDefault();

        const button = document.getElementById('send-feedback');
        const rating = Number(
          document.getElementById('feedback-rating').value
        );
        const category = document.getElementById('feedback-category').value;

        if (!Number.isInteger(rating) || rating < 1 ||
            rating > 5 || !category) {
          status('Selecciona una calificación y una categoría.');
          return;
        }

        button.disabled = true;
        status('Enviando valoración…');

        const { error } = await db
          .from('prototype_feedback')
          .insert({
            rating,
            category,
            page_version: 'github-pages-v1'
          });

        button.disabled = false;

        if (error) {
          console.error(error);
          status('No se pudo guardar la valoración. Revisa Supabase.');
          return;
        }

        form.reset();
        status('¡Gracias! Tu valoración anónima quedó registrada.');
      });
    }

    const host = document.querySelector('#orientacion .help-grid');

    if (host) {
      const { data, error } = await db
        .from('support_channels')
        .select('name,category,description,phone_label,phone_href,whatsapp_label,whatsapp_href,source_url,display_order')
        .eq('is_active', true)
        .order('display_order', { ascending: true });

      if (!error && Array.isArray(data) && data.length) {
        const fragment = document.createDocumentFragment();

        data.forEach((item) => {
          const card = make('article', 'help-card');

          card.append(
            make('div',
              item.category === 'emergency'
                ? 'help-icon emergency'
                : 'help-icon',
              item.category === 'emergency' ? '!' : '+'
            ),
            make('h3', '', item.name),
            make('p', '', item.description)
          );

          const phone = safeLink(
            item.phone_label, item.phone_href, 'btn btn-secondary'
          );

          const whatsapp = safeLink(
            item.whatsapp_label, item.whatsapp_href,
            'database-channel-detail'
          );

          const source = safeLink(
            'Consultar fuente oficial ↗',
            item.source_url,
            'database-channel-source'
          );

          if (phone) card.append(phone);
          if (whatsapp) card.append(whatsapp);
          if (source) card.append(source);

          fragment.append(card);
        });

        host.replaceChildren(fragment);
      } else if (error) {
        console.warn('No fue posible cargar los canales.', error);
      }
    }

    status('Conexión con Supabase lista. Puedes enviar una valoración anónima.');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
