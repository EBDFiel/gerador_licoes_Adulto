/**
 * server.js
 * Pacote alinhado com:
 * - admin-panel.html híbrido
 * - licao.html?preview=admin
 *
 * Como rodar:
 *   npm install express cors
 *   node server.js
 */
const express = require('express');
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '4mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(__dirname));

function escapeHtml(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function normalizeLineBreaks(text = '') {
  return String(text).replace(/\r/g, '').trim();
}

function detectTitleFromBase(conteudoBase = '', fallbackNumero = '') {
  const text = normalizeLineBreaks(conteudoBase);
  const match = text.match(/^Lição\s+(\d+)\s*[:\-–]\s*(.+)$/im) || text.match(/^Licao\s+(\d+)\s*[:\-–]\s*(.+)$/im);
  if (!match) {
    return { numero: fallbackNumero || '', titulo: '' };
  }
  return {
    numero: match[1] ? String(match[1]).trim() : fallbackNumero || '',
    titulo: match[2] ? String(match[2]).trim() : ''
  };
}

function markdownToHtml(text = '') {
  let html = escapeHtml(text);
  html = html.replace(/^###\s+(.*)$/gm, '<h4>$1</h4>');
  html = html.replace(/^##\s+(.*)$/gm, '<h3>$1</h3>');
  html = html.replace(/^#\s+(.*)$/gm, '<h2>$1</h2>');
  html = html.replace(/^\>\s+(.*)$/gm, '<blockquote>$1</blockquote>');
  html = html.replace(/^---$/gm, '<hr>');
  html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/^\-\s+(.*)$/gm, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>)/gs, '<ul>$1</ul>');
  html = html.replace(/<ul>(.*?)<\/ul>/gs, (m, inner) => {
    const items = inner.match(/<li>.*?<\/li>/gs) || [];
    return `<ul>${items.join('')}</ul>`;
  });
  const chunks = html.split(/\n{2,}/).map(s => s.trim()).filter(Boolean);
  html = chunks.map(part => {
    if (/^<(h2|h3|h4|ul|blockquote|hr)/.test(part)) return part;
    return `<p>${part.replace(/\n/g, '<br>')}</p>`;
  }).join('\n');
  return html;
}

function smartTemplate({ numero, titulo, trimestre, data, publico, conteudoBase }) {
  const base = normalizeLineBreaks(conteudoBase);
  const detected = detectTitleFromBase(base, numero);
  const finalNumero = String(numero || detected.numero || '').trim();
  const finalTitulo = String(titulo || detected.titulo || '').trim();
  const sourceWithoutFirstTitle = base
    .replace(/^Lição\s+\d+\s*[:\-–]\s*.+$/im, '')
    .replace(/^Licao\s+\d+\s*[:\-–]\s*.+$/im, '')
    .trim();

  const html = sourceWithoutFirstTitle
    ? `<section>${markdownToHtml(sourceWithoutFirstTitle)}</section>`
    : '<section><p>Conteúdo gerado com sucesso, mas sem corpo principal informado.</p></section>';

  return {
    id: finalNumero ? `licao-${finalNumero}-${publico}` : `licao-preview-${publico}`,
    numero: finalNumero,
    titulo: finalTitulo || 'Lição sem título',
    trimestre: String(trimestre || '').trim(),
    data: String(data || '').trim(),
    publico: String(publico || 'adultos').trim(),
    tipo: String(publico || 'adultos').trim(),
    conteudoHtml: html,
    texto: sourceWithoutFirstTitle || base,
    markdown: sourceWithoutFirstTitle || base
  };
}

app.get('/health', (req, res) => {
  res.json({ ok: true, app: 'EBD Fiel Lesson Generator', timestamp: new Date().toISOString() });
});

app.post('/api/gerar-licao', async (req, res) => {
  try {
    const {
      numero = '',
      titulo = '',
      trimestre = '',
      data = '',
      publico = 'adultos',
      conteudoBase = '',
      mode = 'smart_template'
    } = req.body || {};

    if (!String(trimestre).trim()) return res.status(400).json({ error: 'O campo trimestre é obrigatório.' });
    if (!String(data).trim()) return res.status(400).json({ error: 'O campo data é obrigatório.' });
    if (!String(publico).trim()) return res.status(400).json({ error: 'O campo publico é obrigatório.' });
    if (!String(conteudoBase).trim()) return res.status(400).json({ error: 'O campo conteudoBase é obrigatório.' });

    const lesson = smartTemplate({ numero, titulo, trimestre, data, publico, conteudoBase });
    return res.json({ ok: true, mode, lesson });
  } catch (error) {
    console.error('Erro ao gerar lição:', error);
    return res.status(500).json({ error: 'Erro interno ao gerar a lição.' });
  }
});

// Rotas compatíveis com o painel híbrido
app.post('/api/admin/deepseek/generate', async (req, res) => {
  try {
    const {
      numero = '',
      titulo = '',
      trimestre = '',
      data = '',
      publico = 'adultos',
      textoBase = '',
      formato = 'html'
    } = req.body || {};

    if (!String(textoBase).trim()) {
      return res.status(400).json({ ok: false, erro: 'O campo textoBase é obrigatório.' });
    }

    const lesson = smartTemplate({
      numero, titulo, trimestre, data, publico, conteudoBase: textoBase
    });

    const content = formato === 'texto'
      ? (lesson.texto || '')
      : formato === 'markdown'
      ? (lesson.markdown || '')
      : (lesson.conteudoHtml || '');

    return res.json({
      ok: true,
      content,
      lesson
    });
  } catch (error) {
    console.error('Erro DeepSeek compatível:', error);
    return res.status(500).json({ ok: false, erro: 'Erro ao gerar conteúdo.' });
  }
});

app.post('/api/admin/deepseek/refinar', async (req, res) => {
  try {
    const { texto = '', formato = 'html' } = req.body || {};
    if (!String(texto).trim()) {
      return res.status(400).json({ ok: false, erro: 'Texto vazio para refino.' });
    }

    let content = String(texto).trim();
    if (formato === 'html' && !/<[a-z][\s\S]*>/i.test(content)) {
      content = markdownToHtml(content);
    }

    return res.json({ ok: true, content });
  } catch (error) {
    console.error('Erro ao refinar conteúdo:', error);
    return res.status(500).json({ ok: false, erro: 'Erro ao refinar conteúdo.' });
  }
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin-panel.html'));
});

app.listen(PORT, () => {
  console.log(`EBD Fiel rodando em http://localhost:${PORT}`);
});
