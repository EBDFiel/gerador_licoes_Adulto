# gerador_licoes_Adulto

Backend do gerador de lições EBD Fiel.

## Rotas principais

- `GET /health`
- `POST /api/gerar-licao` — parser antigo/local
- `POST /api/gpt/gerar-licao` — gera lições de Adultos com OpenAI/GPT no prompt aprovado
- `POST /ia` — Professor Fiel via DeepSeek

## Variáveis de ambiente no Render

Obrigatórias para GPT:

- `OPENAI_API_KEY`

Opcionais:

- `OPENAI_MODEL` — padrão: `gpt-4.1-mini`
- `OPENAI_MAX_TOKENS` — padrão: `12000`
- `OPENAI_TEMPERATURE` — padrão: `0.35`

Obrigatória para Professor Fiel/DeepSeek:

- `DEEPSEEK_API_KEY`
