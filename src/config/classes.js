"use strict";

const CLASS_REGISTRY = Object.freeze({
  adult: Object.freeze({
    key: "adult",
    label: "Adultos",
    publico: "adultos",
    articleClass: "adultos",
    gptEndpoint: "/api/gpt/gerar-licao",
    deepseekEndpoint: "/api/deepseek/gerar-licao"
  }),
  youth: Object.freeze({
    key: "youth",
    label: "Jovens",
    publico: "jovens",
    articleClass: "jovens",
    gptEndpoint: "/api/gpt/gerar-licao-jovens",
    deepseekEndpoint: "/api/deepseek/gerar-licao-jovens"
  }),
  teen: Object.freeze({
    key: "teen",
    label: "Adolescentes",
    publico: "adolescentes",
    articleClass: "adolescentes",
    gptEndpoint: "/api/gpt/gerar-licao-adolescentes",
    deepseekEndpoint: "/api/deepseek/gerar-licao-adolescentes"
  }),
  preteen: Object.freeze({
    key: "preteen",
    label: "Pré-adolescentes",
    publico: "pre-adolescentes",
    articleClass: "pre-adolescentes",
    gptEndpoint: "/api/gpt/gerar-licao-preadolescentes",
    deepseekEndpoint: "/api/deepseek/gerar-licao-preadolescentes"
  })
});

const CLASS_KEYS = Object.freeze(Object.keys(CLASS_REGISTRY));

function normalizeClassKey(value = "adult") {
  const raw = String(value || "adult").trim().toLowerCase();
  if (["youth", "jovens", "jovem"].includes(raw)) return "youth";
  if (["teen", "teens", "adolescentes", "adolescente"].includes(raw)) return "teen";
  if (["preteen", "preteens", "preadolescentes", "pre-adolescentes", "pre_adolescentes", "pré-adolescentes", "pré adolescente", "pre adolescente"].includes(raw)) return "preteen";
  return "adult";
}

function getClassMeta(value = "adult") {
  return CLASS_REGISTRY[normalizeClassKey(value)] || CLASS_REGISTRY.adult;
}

module.exports = { CLASS_REGISTRY, CLASS_KEYS, normalizeClassKey, getClassMeta };
