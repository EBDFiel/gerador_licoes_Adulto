"use strict";

function normalizeText(value = "") {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
}


function titleSimilarity(a, b) {
  const tokens = (value) => new Set(String(value || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/).filter((word) => word.length > 2 && !["licao", "para", "com", "uma", "dos", "das", "que"].includes(word)));
  const left = tokens(a);
  const right = tokens(b);
  if (!left.size || !right.size) return 0;
  const common = [...left].filter((word) => right.has(word)).length;
  return common / Math.min(left.size, right.size);
}

function normalizeClassKey(value = "") {
  const source = String(value || "").trim().toLowerCase();
  if (["youth", "jovem", "jovens"].includes(source)) return "youth";
  if (["teen", "adolescente", "adolescentes"].includes(source)) return "teen";
  if (["preteen", "pre-adolescente", "pre-adolescentes", "preadolescente", "preadolescentes"].includes(source)) return "preteen";
  return "adult";
}

function countMatches(text, regex) {
  return [...String(text || "").matchAll(regex)].length;
}

function validateSource({ number, title, sourceText }) {
  const errors = [];
  const warnings = [];
  const text = String(sourceText || "").trim();
  if (!Number(number)) errors.push("Número da lição ausente.");
  if (!String(title || "").trim()) errors.push("Título da lição ausente.");
  if (text.length < 300) errors.push("Conteúdo-base vazio ou muito curto.");
  if (text.length > Number(process.env.EBD_V2_SOURCE_MAX_CHARS || 180000)) errors.push("Conteúdo-base maior que o limite permitido.");

  const match = text.match(/li[cç][aã]o\s*0*(\d+)\s*[:\-—•]?\s*([^\n]{3,180})/i);
  if (match && Number(match[1]) !== Number(number)) {
    warnings.push(`O conteúdo parece pertencer à Lição ${Number(match[1])}, mas o painel informa Lição ${Number(number)}.`);
  }
  if (match && title && titleSimilarity(title, match[2]) < 0.35) {
    warnings.push(`O título detectado no conteúdo parece diferente do título informado no painel.`);
  }
  ["abrir apoio pedagógico", "aceitar cookies", "menu principal", "compartilhe nas redes"].forEach((term) => {
    if (text.toLowerCase().includes(term)) warnings.push(`Possível texto de interface encontrado: ${term}.`);
  });
  return { errors, warnings };
}

function validateHtml({ html, classKey, metadata = {} }) {
  const source = String(html || "").trim();
  const key = normalizeClassKey(classKey);
  const text = normalizeText(source.replace(/<[^>]+>/g, " "));
  const errors = [];
  const warnings = [];

  if (!/^<!DOCTYPE html>/i.test(source)) errors.push("O HTML não começa com <!DOCTYPE html>.");
  if (!/<html[\s>]/i.test(source)) errors.push("A tag <html> não foi encontrada.");
  if (!/<\/html>\s*$/i.test(source)) errors.push("O HTML não termina com </html>.");
  if (!/<body[\s>]/i.test(source)) errors.push("A tag <body> não foi encontrada.");
  if (source.length < 1500) warnings.push("O documento parece curto para um apoio pedagógico completo.");

  const title = String(metadata.title || metadata.titulo || "").trim();
  if (title && !normalizeText(source).includes(normalizeText(title))) errors.push("O título selecionado não aparece no HTML.");

  ["REFERENCIA INDICADA", "A SEREM INDICADOS", "CONTEUDO ORIGINAL AUTORIZADO", "TITULO COMPLETO DA LICAO", "ATITUDE CONCRETA"].forEach((placeholder) => {
    if (text.includes(placeholder)) errors.push(`Placeholder não preenchido: ${placeholder}.`);
  });

  const requiredByClass = {
    adult: ["TEXTO AUREO", "VERDADE APLICADA", "OBJETIVOS DA LICAO", "TEXTOS DE REFERENCIA", "MOTIVO DE ORACAO", "ESBOCO DA LICAO", "ANALISE GERAL", "INTRODUCAO", "EU ENSINEI QUE", "CONCLUSAO"],
    youth: ["TEXTO DE REFERENCIA", "VERSICULO DO DIA", "VERDADE APLICADA", "OBJETIVOS DA LICAO", "MOMENTO DE ORACAO", "INTRODUCAO", "PONTO-CHAVE", "SUBSIDIO PARA O EDUCADOR", "CONCLUSAO", "COMPLEMENTANDO", "EU ENSINEI QUE"],
    teen: ["BASE BIBLICA", "VERSICULO-CHAVE", "OBJETIVO DA LICAO", "PONTO DE PARTIDA", "INTRODUCAO", "PERGUNTAS DE ABERTURA", "ATIVIDADE EM GRUPO", "CONCLUSAO", "SINTESE DA LICAO", "COMPLEMENTO", "CACA-PALAVRAS DA LICAO"],
    preteen: ["TEXTO BIBLICO", "MENSAGEM VALIOSA", "VERDADE APLICADA", "INTRODUCAO", "PERGUNTAS DE ABERTURA", "CONCLUINDO", "SINTESE DA LICAO", "CACA-PALAVRAS DA LICAO"]
  };
  requiredByClass[key].forEach((label) => {
    if (!text.includes(label)) errors.push(`Seção obrigatória ausente: ${label}.`);
  });

  if (key === "adult") {
    if (!source.includes("licao-container")) errors.push("Classe HTML licao-container ausente.");
    if (/licao-betel\s+(jovens|adolescentes|pre-adolescentes)/i.test(source)) errors.push("Estrutura HTML de outra classe encontrada.");
  }
  if (key === "youth") {
    if (!/class=["'][^"']*licao-betel[^"']*jovens/i.test(source)) errors.push("Artigo da Classe Jovens ausente.");
    if (text.includes("TEXTO AUREO") || text.includes("MOTIVO DE ORACAO")) errors.push("Rótulos de Adultos encontrados na lição Jovens.");
    if (text.includes("LEITURAS DIARIAS")) errors.push("Leituras Diárias não deve aparecer.");
  }
  if (key === "teen") {
    if (!/class=["'][^"']*licao-betel[^"']*adolescentes/i.test(source)) errors.push("Artigo da Classe Adolescentes ausente.");
    if (/\b[123]\.\d+\./.test(source.replace(/<[^>]+>/g, " "))) errors.push("Subtópicos numerados são proibidos para Adolescentes.");
    if (countMatches(source, /class=["'][^"']*\bpergunta\b[^"']*["']/gi) < 3) errors.push("Devem existir três perguntas de abertura.");
    if (!/data-caca-palavras-id=["']teen-\d{2}["']/i.test(source)) errors.push("Identificador teen-XX do caça-palavras ausente.");
    if (/\bJOGO\b/.test(text)) errors.push("A palavra jogo é proibida nesta classe.");
  }
  if (key === "preteen") {
    if (!/class=["'][^"']*licao-betel[^"']*pre-adolescentes/i.test(source)) errors.push("Artigo da Classe Pré-adolescentes ausente.");
    if (/\b[123]\.\d+\./.test(source.replace(/<[^>]+>/g, " "))) errors.push("Subtópicos numerados são proibidos para Pré-adolescentes.");
    if (countMatches(source, /class=["'][^"']*\bpergunta\b[^"']*["']/gi) < 3) errors.push("Devem existir três perguntas de abertura.");
    if (!/data-caca-palavras-id=["']preteen-\d{2}["']/i.test(source)) errors.push("Identificador preteen-XX do caça-palavras ausente.");
    if (text.includes("PERSONAGENS MENCIONADOS") || text.includes("REFERENCIAS BIBLICAS")) errors.push("Listas finais proibidas para Pré-adolescentes.");
    if (/\bJOGO\b/.test(text)) errors.push("A palavra jogo é proibida nesta classe.");
  }

  if (!text.includes("APLICACAO PRATICA")) warnings.push("Nenhuma Aplicação Prática foi localizada.");
  return { errors: [...new Set(errors)], warnings: [...new Set(warnings)] };
}

module.exports = {
  normalizeClassKey,
  validateSource,
  validateHtml
};
