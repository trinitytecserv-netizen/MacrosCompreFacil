// Função serverless da Vercel: lê um print de tela com o Google Gemini (plano gratuito)
// e devolve as viagens em JSON.
// Requer a variável de ambiente GEMINI_API_KEY (Vercel > Settings > Environment Variables).

const PROMPT = `Esta imagem é um print de uma tabela de viagens de transporte.
Para cada linha da tabela (cada linha é uma viagem distinta), extraia os valores das colunas "Motorista", "Veículo" e "Descrição".

Regras:
- Copie os textos exatamente como aparecem no print, sem corrigir nem traduzir.
- Ignore linhas de cabeçalho, totais e linhas vazias.
- Se um campo estiver ilegível ou ausente, use string vazia.
- Mantenha a ordem das linhas, de cima para baixo.

Responda SOMENTE com JSON válido, sem texto antes ou depois, neste formato:
{"viagens":[{"motorista":"","veiculo":"","descricao":""}]}`;

// Modelos tentados em ordem. Você pode forçar um modelo com a variável GEMINI_MODEL.
const MODELOS = [process.env.GEMINI_MODEL, 'gemini-3-flash-preview', 'gemini-3.1-flash-lite'].filter(Boolean);

function parseViagens(text) {
  const clean = String(text || '').replace(/```json|```/g, '').trim();
  const start = clean.indexOf('{');
  const end = clean.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('Resposta sem JSON');
  const data = JSON.parse(clean.slice(start, end + 1));
  const lista = Array.isArray(data.viagens) ? data.viagens : [];
  return lista.map((v) => ({
    motorista: String(v.motorista || '').trim(),
    veiculo: String(v.veiculo || '').trim(),
    descricao: String(v.descricao || '').trim(),
  }));
}

async function chamarGemini(modelo, apiKey, image, mediaType) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            { inline_data: { mime_type: mediaType || 'image/jpeg', data: image } },
            { text: PROMPT },
          ],
        },
      ],
      generationConfig: { responseMimeType: 'application/json', temperature: 0 },
    }),
  });
  const data = await resp.json().catch(() => ({}));
  return { resp, data };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Método não permitido.' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'GEMINI_API_KEY não configurada na Vercel.' });
  }

  const { image, mediaType } = req.body || {};
  if (!image || typeof image !== 'string') {
    return res.status(400).json({ error: 'Imagem não enviada.' });
  }

  let ultimoErro = 'Erro desconhecido.';
  for (const modelo of MODELOS) {
    try {
      const { resp, data } = await chamarGemini(modelo, apiKey, image, mediaType);

      if (resp.ok) {
        const parts = (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) || [];
        const text = parts.map((p) => p.text || '').join('\n');
        return res.status(200).json({ viagens: parseViagens(text) });
      }

      ultimoErro = (data && data.error && data.error.message) || 'Erro na API do Gemini.';
      // Modelo inexistente ou limite atingido: tenta o próximo da lista.
      if (resp.status === 404 || resp.status === 429) continue;
      // Chave inválida ou requisição ruim: não adianta tentar outro modelo.
      return res.status(502).json({ error: 'Falha ao ler o print: ' + ultimoErro });
    } catch (err) {
      ultimoErro = 'Não foi possível interpretar a resposta do Gemini.';
    }
  }

  return res.status(502).json({ error: 'Falha ao ler o print: ' + ultimoErro });
};
