// Função serverless da Vercel: lê um print de tela e devolve as viagens em JSON.
// Requer a variável de ambiente ANTHROPIC_API_KEY (Vercel > Settings > Environment Variables).

const PROMPT = `Esta imagem é um print de uma tabela de viagens de transporte.
Para cada linha da tabela (cada linha é uma viagem distinta), extraia os valores das colunas "Motorista", "Veículo" e "Descrição".

Regras:
- Copie os textos exatamente como aparecem no print, sem corrigir nem traduzir.
- Ignore linhas de cabeçalho, totais e linhas vazias.
- Se um campo estiver ilegível ou ausente, use string vazia.
- Mantenha a ordem das linhas, de cima para baixo.

Responda SOMENTE com JSON válido, sem texto antes ou depois, neste formato:
{"viagens":[{"motorista":"","veiculo":"","descricao":""}]}`;

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

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Método não permitido.' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY não configurada na Vercel.' });
  }

  const { image, mediaType } = req.body || {};
  if (!image || typeof image !== 'string') {
    return res.status(400).json({ error: 'Imagem não enviada.' });
  }

  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: process.env.CLAUDE_MODEL || 'claude-sonnet-5-5',
        max_tokens: 4000,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: { type: 'base64', media_type: mediaType || 'image/jpeg', data: image },
              },
              { type: 'text', text: PROMPT },
            ],
          },
        ],
      }),
    });

    const data = await resp.json();
    if (!resp.ok) {
      const msg = (data && data.error && data.error.message) || 'Erro na API.';
      return res.status(502).json({ error: 'Falha ao ler o print: ' + msg });
    }

    const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
    return res.status(200).json({ viagens: parseViagens(text) });
  } catch (err) {
    return res.status(500).json({ error: 'Não foi possível interpretar o print. Tente novamente.' });
  }
};
