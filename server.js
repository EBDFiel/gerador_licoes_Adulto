const express = require('express');
const cors = require('cors');
const path = require('path');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Servir arquivos estáticos da pasta public (CORRIGIDO)
app.use(express.static(path.join(__dirname, 'public')));

// Inicializar Gemini AI
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Função para limpar texto
function limparTexto(texto) {
    if (!texto) return "";
    return texto
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, '')
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .trim();
}

// Função para extrair informações
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
        } else if (linhaUpper.includes('VERDADE APLICADA')) {
            let conteudo = linha.replace(/VERDADE APLICADA/gi, '').replace(/:/g, '').trim();
            if (!conteudo && i + 1 < linhas.length) {
                conteudo = linhas[i + 1].trim();
            }
            verdadeAplicada = conteudo;
        } else if (linhaUpper.includes('OBJETIVOS') && linhaUpper.includes('LIÇÃO')) {
            let objetivosText = [];
            let j = i + 1;
            while (j < linhas.length && linhas[j].trim() && !linhas[j].toUpperCase().includes('TEXTO') && !linhas[j].toUpperCase().includes('VERDADE')) {
                objetivosText.push(linhas[j].trim());
                j++;
            }
            objetivos = objetivosText.join('\n');
        } else if (linha.trim() && !linhaUpper.includes('TEXTO ÁUREO') && !linhaUpper.includes('VERDADE APLICADA') && !linhaUpper.includes('OBJETIVOS')) {
            corpoTexto += linha + "\n";
        }
    }
    
    return { textoAureo, verdadeAplicada, objetivos, corpoTexto: corpoTexto.trim() };
}

// Função para gerar lição
async function gerarLicaoCompleta(titulo, textoOriginal, publico) {
    try {
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        
        const { textoAureo, verdadeAplicada, objetivos, corpoTexto } = extrairInformacoes(textoOriginal);
        
        const prompt = `Você é um professor de Escola Bíblica Dominical. Crie uma lição completa para ${publico} com o título: "${titulo}"

Use estas informações:
- Texto Áureo: ${textoAureo || "Neemias 1.4"}
- Verdade Aplicada: ${verdadeAplicada || "Dependência do Senhor"}
- Objetivos: ${objetivos || "Compreender, agir e reconhecer"}
- Texto de apoio: ${corpoTexto.substring(0, 4000)}

CRIE A LIÇÃO NO SEGUINTE FORMATO (com conteúdo real, sem colchetes):

${titulo}

📖 TEXTO ÁUREO
[insira o texto áureo completo]

🎯 VERDADE APLICADA
[insira a verdade aplicada]

📚 TEXTOS DE REFERÊNCIA
[insira os versículos]

🔍 ANÁLISE GERAL
[escreva 3 parágrafos]

✍️ INTRODUÇÃO
[escreva 2-3 parágrafos]

1. [TÍTULO DO PRIMEIRO TÓPICO]
[texto explicativo]

1.1. [Subtítulo]
[texto explicativo]

1.2. [Subtítulo]
[texto explicativo]

📚 APOIO PEDAGÓGICO
[sugestões para o professor]

⚡ APLICAÇÃO PRÁTICA
[sugestões para os alunos]

2. [TÍTULO DO SEGUNDO TÓPICO]
[texto explicativo]

2.1. [Subtítulo]
[texto explicativo]

2.2. [Subtítulo]
[texto explicativo]

💡 EU ENSINEI QUE
[frase de destaque]

2.3. [Subtítulo]
[texto explicativo]

📚 APOIO PEDAGÓGICO
[sugestões]

⚡ APLICAÇÃO PRÁTICA
[sugestões]

3. [TÍTULO DO TERCEIRO TÓPICO]
[texto explicativo]

3.1. [Subtítulo]
[texto explicativo]

3.2. [Subtítulo]
[texto explicativo]

💡 EU ENSINEI QUE
[frase de destaque]

3.3. [Subtítulo]
[texto explicativo]

📚 APOIO PEDAGÓGICO
[sugestões]

⚡ APLICAÇÃO PRÁTICA
[sugestões]

🏁 CONCLUSÃO
[2-3 parágrafos]

📚 APOIO PEDAGÓGICO FINAL
[orientações finais]

⚡ APLICAÇÃO PRÁTICA FINAL
[desafios para a semana]

IMPORTANTE: 
- Gere CONTEÚDO REAL, não use colchetes como placeholders
- Os tópicos devem ter títulos criativos e relevantes
- Use citações bíblicas ao longo do texto`;

        const result = await model.generateContent(prompt);
        const response = await result.response;
        let textoGerado = response.text();
        
        // Limpar placeholders
        textoGerado = textoGerado.replace(/\[[^\]]+\]/g, '');
        textoGerado = textoGerado.replace(/texto do tópico/gi, '');
        textoGerado = textoGerado.replace(/texto do subtópico/gi, '');
        textoGerado = textoGerado.replace(/Primeiro subtópico/gi, '');
        textoGerado = textoGerado.replace(/Segundo subtópico/gi, '');
        textoGerado = textoGerado.replace(/Terceiro subtópico/gi, '');
        textoGerado = textoGerado.replace(/Subtítulo/gi, '');
        
        return textoGerado;
        
    } catch (error) {
        console.error("Erro ao gerar lição:", error);
        throw new Error("Falha ao gerar lição: " + error.message);
    }
}

// Rota da API
app.post('/api/gerar-licao-completa', async (req, res) => {
    try {
        const { titulo, textoOriginal, publico } = req.body;
        
        console.log("=== REQUISIÇÃO RECEBIDA ===");
        console.log("Título:", titulo);
        console.log("Publico:", publico);
        console.log("Texto tamanho:", textoOriginal?.length || 0);
        
        if (!titulo || !textoOriginal) {
            return res.status(400).json({ error: "Título e texto são obrigatórios" });
        }
        
        const textoLimpo = limparTexto(textoOriginal);
        const licaoCompleta = await gerarLicaoCompleta(titulo, textoLimpo, publico);
        
        res.json({ licaoCompleta });
        
    } catch (error) {
        console.error("Erro:", error);
        res.status(500).json({ error: error.message });
    }
});

// Rota principal - serve o index.html
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
});

app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
    console.log(`Acesse: http://localhost:${PORT}`);
});
