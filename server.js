import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// TESTE
app.get("/health", (req, res) => {
  res.json({ ok: true });
});

// ROTA IA (simples por enquanto)
app.post("/api/gerar-complementos", (req, res) => {
  res.json({
    analiseGeral: "Gerado automaticamente",
    apoioPedagogico: "Explicação pedagógica gerada",
    aplicacaoPratica: "Aplicação prática gerada"
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Servidor rodando na porta " + PORT);
});
