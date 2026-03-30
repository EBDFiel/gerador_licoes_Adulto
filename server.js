const express = require('express');
const cors = require('cors');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Inicializar Gemini AI
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Função para limpar e formatar o texto
function limparTexto(texto) {
    if (!texto) return "";
    return texto
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, '')
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .trim();
}

// Função para extrair informações do texto
function extrairInformacoes(textoCompleto) {
    let textoAureo = "";
    let verdadeAplicada = "";
    let objetivos = "";
    let corpoTexto = "";
    
    const linhas = textoCompleto.split('\n');
    
    for (let i = 0; i < linhas.length; i++) {
        const linha = linhas[i];
        const linhaUpper = linha.toUpperCase();
        
        if (linhaUpper.includes('TEXTO ÁUREO') || linhaUpper.includes('TEXTO AUREO')) {
            let conteudo = linha.replace(/TEXTO ÁUREO/gi, '').replace(/TEXTO AUREO/gi, '').replace(/:/g, '').trim();
            if (!conteudo && i + 1 < linhas.length) {
                conteudo = linhas[i + 1].trim();
            }
            textoAureo = conteudo;
            continue;
        }
        
        if (linhaUpper.includes('VERDADE APLICADA')) {
            let conteudo = linha.replace(/VERDADE APLICADA/gi, '').replace(/:/g, '').trim();
            if (!conteudo && i + 1 < linhas.length) {
                conteudo = linhas[i + 1].trim();
            }
            verdadeAplicada = conteudo;
            continue;
        }
        
        if (linhaUpper.includes('OBJETIVOS') && linhaUpper.includes('LIÇÃO')) {
            let objetivosText = [];
            let j = i + 1;
            while (j < linhas.length && linhas[j].trim() && !linhas[j].toUpperCase().includes('TEXTO') && !linhas[j].toUpperCase().includes('VERDADE')) {
                objetivosText.push(linhas[j].trim());
                j++;
            }
            objetivos = objetivosText.join('\n');
            continue;
        }
        
        if (linha.trim() && !linhaUpper.includes('TEXTO ÁUREO') && !linhaUpper.includes('VERDADE APLICADA') && !linhaUpper.includes('OBJETIVOS')) {
            corpoTexto += linha + "\n";
        }
    }
    
    return { textoAureo, verdadeAplicada, objetivos, corpoTexto: corpoTexto.trim() };
}

// Função para gerar a lição completa
async function gerarLicaoCompleta(titulo, textoOriginal, publico) {
    try {
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        
        // Extrair informações do texto
        const { textoAureo, verdadeAplicada, objetivos, corpoTexto } = extrairInformacoes(textoOriginal);
        
        // Construir o prompt
        const prompt = `Você é um professor de Escola Bíblica Dominical (EBD) especialista em criar lições para a classe de ${publico}.

Crie uma lição COMPLETA e DETALHADA com o título: "${titulo}"

Use as informações abaixo como base:

TEXTO ÁUREO: ${textoAureo || "Neemias 1.4"}
VERDADE APLICADA: ${verdadeAplicada || "Dependência do Senhor nos desafios"}
OBJETIVOS DA LIÇÃO: ${objetivos || "Compreender o contexto de Neemias, saber agir em adversidades, reconhecer o chamado de Deus"}
TEXTO DE APOIO: ${corpoTexto.substring(0, 5000) || "Neemias recebe notícias sobre Jerusalém e reage com choro e oração"}

A lição deve seguir EXATAMENTE esta estrutura, com CONTEÚDO REAL e COMPLETO em cada seção:

${titulo}

📖 TEXTO ÁUREO
[Insira aqui o texto áureo completo com citação bíblica]

🎯 VERDADE APLICADA
[Insira aqui a verdade aplicada completa]

📚 TEXTOS DE REFERÊNCIA
[Insira aqui os versículos principais da lição]

🔍 ANÁLISE GERAL
[Escreva uma análise detalhada com 3 a 4 parágrafos sobre o contexto, as verdades bíblicas e os impactos práticos]

✍️ INTRODUÇÃO
[Escreva uma introdução com 2 a 3 parágrafos]

1. [PRIMEIRO TÓPICO PRINCIPAL - crie um título relevante]
[Escreva um texto explicativo sobre este tópico]

1.1. [Primeiro subtópico - crie um título]
[Escreva um texto explicativo detalhado]

1.2. [Segundo subtópico - crie um título]
[Escreva um texto explicativo detalhado]

📚 APOIO PEDAGÓGICO
[Escreva sugestões para o professor sobre como ensinar este tópico]

⚡ APLICAÇÃO PRÁTICA
[Escreva sugestões práticas para os alunos aplicarem no dia a dia]

2. [SEGUNDO TÓPICO PRINCIPAL - crie um título relevante]
[Escreva um texto explicativo sobre este tópico]

2.1. [Primeiro subtópico - crie um título]
[Escreva um texto explicativo detalhado]

2.2. [Segundo subtópico - crie um título]
[Escreva um texto explicativo detalhado]

💡 EU ENSINEI QUE
[Escreva uma frase de destaque sobre o que foi ensinado]

2.3. [Terceiro subtópico - crie um título, se necessário]
[Escreva um texto explicativo detalhado]

📚 APOIO PEDAGÓGICO
[Escreva sugestões para o professor sobre como ensinar este tópico]

⚡ APLICAÇÃO PRÁTICA
[Escreva sugestões práticas para os alunos aplicarem no dia a dia]

3. [TERCEIRO TÓPICO PRINCIPAL - crie um título relevante]
[Escreva um texto explicativo sobre este tópico]

3.1. [Primeiro subtópico - crie um título]
[Escreva um texto explicativo detalhado]

3.2. [Segundo subtópico - crie um título]
[Escreva um texto explicativo detalhado]

💡 EU ENSINEI QUE
[Escreva uma frase de destaque sobre o que foi ensinado]

3.3. [Terceiro subtópico - crie um título, se necessário]
[Escreva um texto explicativo detalhado]

📚 APOIO PEDAGÓGICO
[Escreva sugestões para o professor sobre como ensinar este tópico]

⚡ APLICAÇÃO PRÁTICA
[Escreva sugestões práticas para os alunos aplicarem no dia a dia]

🏁 CONCLUSÃO
[Escreva uma conclusão com 2 a 3 parágrafos]

📚 APOIO PEDAGÓGICO FINAL
[Escreva orientações finais para o professor]

⚡ APLICAÇÃO PRÁTICA FINAL
[Escreva desafios práticos para a semana]

IMPORTANTE:
- Gere CONTEÚDO REAL em todas as seções, NÃO use colchetes ou placeholders
- Os tópicos e subtópicos devem ter títulos criativos e relevantes
- O conteúdo deve ser teologicamente sólido e adequado para ${publico}
- Use linguagem clara e acessível
- As seções APOIO PEDAGÓGICO e APLICAÇÃO PRÁTICA devem ser específicas e úteis
- Inclua citações bíblicas relevantes ao longo do texto

Agora, crie a lição completa com conteúdo REAL.`;

        console.log("Enviando prompt para IA...");
        console.log("Título:", titulo);
        console.log("Tamanho do texto:", textoOriginal.length);
        
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const textoGerado = response.text();
        
        console.log("Resposta recebida. Tamanho:", textoGerado.length);
        
        return textoGerado;
        
    } catch (error) {
        console.error("Erro ao gerar lição:", error);
        throw new Error("Falha ao interpretar a resposta da IA: " + error.message);
    }
}

// Rota principal
app.post('/api/gerar-licao-completa', async (req, res) => {
    try {
        const { titulo, textoOriginal, publico } = req.body;
        
        console.log("=== NOVA REQUISIÇÃO RECEBIDA ===");
        console.log("Título:", titulo);
        console.log("Público:", publico);
        console.log("Tamanho texto original:", textoOriginal?.length || 0);
        console.log("Primeiros 500 caracteres:", textoOriginal?.substring(0, 500));
        
        // Validações
        if (!titulo || titulo.trim() === "") {
            return res.status(400).json({ error: "Título é obrigatório" });
        }
        
        if (!textoOriginal || textoOriginal.trim() === "") {
            return res.status(400).json({ error: "Texto original é obrigatório" });
        }
        
        if (textoOriginal.length < 100) {
            return res.status(400).json({ error: "Texto muito curto. Cole a lição completa (mínimo 100 caracteres)." });
        }
        
        // Limpar texto
        const textoLimpo = limparTexto(textoOriginal);
        
        console.log("Texto limpo. Tamanho:", textoLimpo.length);
        
        // Gerar lição
        const licaoCompleta = await gerarLicaoCompleta(titulo, textoLimpo, publico);
        
        if (!licaoCompleta || licaoCompleta.trim() === "") {
            throw new Error("Resposta vazia da IA");
        }
        
        console.log("Lição gerada com sucesso. Tamanho:", licaoCompleta.length);
        console.log("Primeiras 500 caracteres:", licaoCompleta.substring(0, 500));
        
        // Remover placeholders residuais
        let resultadoFinal = licaoCompleta;
        resultadoFinal = resultadoFinal.replace(/\[[^\]]+\]/g, '');
        resultadoFinal = resultadoFinal.replace(/texto do tópico/gi, '');
        resultadoFinal = resultadoFinal.replace(/texto do subtópico/gi, '');
        resultadoFinal = resultadoFinal.replace(/Primeiro subtópico/gi, '');
        resultadoFinal = resultadoFinal.replace(/Segundo subtópico/gi, '');
        resultadoFinal = resultadoFinal.replace(/Terceiro subtópico/gi, '');
        
        res.json({ licaoCompleta: resultadoFinal });
        
    } catch (error) {
        console.error("Erro no endpoint:", error);
        res.status(500).json({ error: "Falha ao interpretar a resposta da IA: " + error.message });
    }
});

// Rota de health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Iniciar servidor
app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
    console.log(`API disponível em: http://localhost:${PORT}/api/gerar-licao-completa`);
});
