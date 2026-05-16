const express = require('express');
const fetch = require('node-fetch');
const app = express();
const PORT = process.env.PORT || 3000;

let ML_STORAGE = {
  access_token: "",
  refresh_token: ""
};

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.get('/auth', (req, res) => {
  const protocol = req.headers['x-forwarded-proto'] || req.protocol;
  const host = req.get('host');
  const origin = `${protocol}://${host}`;
  
  const CLIENT_ID = "3398331082714261";
  const REDIRECT_URI = origin + "/callback";
  const authUrl = `https://auth.mercadolivre.com.br/authorization?response_type=code&client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`;
  res.redirect(authUrl);
});

app.get('/callback', async (req, res) => {
  const code = req.query.code;
  if (!code) return res.status(400).send("Código não encontrado");

  const protocol = req.headers['x-forwarded-proto'] || req.protocol;
  const host = req.get('host');
  const origin = `${protocol}://${host}`;

  try {
    const resp = await fetch("https://api.mercadolibre.com/oauth/token", {
      method: "POST",
      headers: { 
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "application/json"
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: "3398331082714261",
        client_secret: "h7DINwuBFZ5YjbA47OQcNHQf5GSangec", 
        code: code,
        redirect_uri: origin + "/callback"
      }).toString()
    });

    const data = await resp.json();
    if (data.access_token) {
      ML_STORAGE.access_token = data.access_token;
      ML_STORAGE.refresh_token = data.refresh_token || "";
      return res.redirect('/');
    }
    res.status(400).send("Erro na autenticação: " + JSON.stringify(data));
  } catch (e) {
    res.status(500).send("Erro interno no callback: " + e.message);
  }
});

app.post('/sincronizar', async (req, res) => {
  const tokenML = ML_STORAGE.access_token;
  if (!tokenML) return res.json({ ok: false, erro: "Mercado Livre não autenticado" });

  const DROPI_TOKEN = "DRKWoaOneU";
  let dropiData;

  try {
    // LINK OFICIAL E ATIVO DA DROPI INTERNACIONAL (.COM)
    const dropiResp = await fetch("https://api.dropi.com/v1/products?limit=10", {
      method: "GET",
      headers: {
        "x-api-key": DROPI_TOKEN,
        "Authorization": `Bearer ${DROPI_TOKEN}`,
        "Content-Type": "application/json"
      }
    });
    
    dropiData = await dropiResp.json();
  } catch(err) {
    return res.json({ ok: false, erro: "Erro de comunicação com a Dropi: " + err.message });
  }
  
  if (!dropiData || !dropiData.data || dropiData.data.length === 0) {
    return res.json({ ok: false, erro: "Nenhum produto localizado na Dropi. Verifique sua lista de produtos importados." });
  }

  const produtoDropi = dropiData.data[0];
  const tituloOriginal = produtoDropi.title || "Produto Nacional";
  let tituloML = tituloOriginal.length > 60 ? tituloOriginal.substring(0, 60) : tituloOriginal;

  let categoryId = "MLB270726"; 
  try {
    const predResp = await fetch(`https://api.mercadolibre.com/sites/MLB/category_predictor/predict?title=${encodeURIComponent(tituloML)}`, {
      headers: { "Authorization": "Bearer " + tokenML }
    });
    const predData = await predResp.json();
    if (predData && predData.id) categoryId = predData.id;
  } catch (e) {}

  let listaFotos = [];
  if (produtoDropi.images && produtoDropi.images.length > 0) {
    listaFotos = produtoDropi.images.map(img => ({ source: img.url || img }));
  } else {
    listaFotos.push({ source: "https://via.placeholder.com/500" });
  }

  const precoCusto = parseFloat(produtoDropi.price || 0);
  if (precoCusto <= 0) return res.json({ ok: false, erro: "Preço de custo zerado na Dropi." });
  const precoVendaML = precoCusto * 1.40; 

  const textoDescricaoBase = produtoDropi.description && produtoDropi.description.trim().length > 10
    ? produtoDropi.description.trim() 
    : "Produto nacional de excelente qualidade, testado e aprovado.";

  const descricaoFinal = `${textoDescricaoBase}\n\n🚀 ENVIADO DIRETO DO BRASIL VIA MERCADO ENVIOS!`;

  const itemML = {
    title: tituloML, 
    category_id: categoryId, 
    price: Math.round(precoVendaML * 100) / 100, 
    currency_id: "BRL",
    available_quantity: produtoDropi.stock > 0 ? produtoDropi.stock : 5, 
    buying_mode: "buy_it_now",
    listing_type_id: "gold_special",
    condition: "new",
    status: "active", 
    description: { plain_text: descricaoFinal },
    pictures: listaFotos,
    attributes: [{ id: "BRAND", value_name: "Genérico" }, { id: "MODEL", value_name: "Genérico" }],
    shipping: { mode: "me2", local_pick_up: false, free_shipping: false }
  };

  try {
    const mlResp = await fetch("https://api.mercadolibre.com/items", {
      method: "POST",
      headers: { 
        "Authorization": "Bearer " + tokenML, 
        "Content-Type": "application/json"
      },
      body: JSON.stringify(itemML)
    });
    
    const mlData = await mlResp.json();
    if (mlData.id) {
      return res.json({ ok: true, msg: `Produto '${itemML.title}' sincronizado com sucesso!`, permalink: mlData.permalink });
    }
    return res.json({ ok: false, erro: mlData.message || "Erro ao publicar no ML" });
  } catch (err) {
    return res.json({ ok: false, erro: "Erro ao enviar para o ML: " + err.message });
  }
});

app.get('/', (req, res) => {
  const conectado = ML_STORAGE.access_token ? true : false;

  let pagina = "<!DOCTYPE html><html><head><meta charset='UTF-8'><title>MaxVendasTop Automação</title>";
  pagina += "<style>body{font-family:sans-serif;background:#f5f5f5;margin:0}";
  pagina += ".top{background:#1a1a2e;color:#fff;padding:20px 30px}";
  pagina += ".top h1{font-size:22px;margin:0}.sub{font-size:13px;opacity:.7;margin-top:5px}";
  pagina += ".box{background:#fff;border-radius:12px;padding:24px;margin:20px auto;max-width:700px;box-shadow:0 1px 4px rgba(0,0,0,.1)}";
  pagina += "h2{font-size:16px;margin-top:0;margin-bottom:16px;color:#1a1a2e}";
  pagina += ".ok{background:#e8f5e9;color:#2e7d32;padding:10px;border-radius:8px;font-size:14px;margin-bottom:15px}";
  pagina += ".err{background:#fff3e0;color:#e65100;padding:10px;border-radius:8px;font-size:14px;margin-bottom:15px}";
  pagina += ".btn{background:#3483FA;color:#fff;border:none;padding:12px 20px;border-radius:8px;font-size:15px;cursor:pointer;width:100%;margin-top:12px;display:block;text-align:center;text-decoration:none;font-weight:bold}";
  pagina += ".btn-sync{background:#ff7b00;}"; 
  pagina += "#msg-sync{display:none;padding:12px;border-radius:8px;margin-top:12px;font-size:14px;word-break:break-all;}";
  pagina += "</style></head><body>";
  
  pagina += "<div class='top'><h1>MaxVendasTop</h1><div class='sub'>Automação Dropshipping: Dropi -> Mercado Livre</div></div>";
  pagina += "<div class='box'><h2>Status das Conexões</h2>";

  if (conectado) {
    pagina += "<div class='ok'>✅ Mercado Livre: Conectado</div>";
    pagina += "<div class='ok'>✅ Integração Dropi: Pronta para Rodar</div>";
  } else {
    pagina += "<div class='err'>❌ Mercado Livre: Não conectado</div>";
    pagina += "<a href='/auth' class='btn'>Conectar minha conta do ML</a>";
  }
  pagina += "</div>";

  if (conectado) {
    pagina += "<div class='box'><h2>Painel de Automação Real</h2>";
    pagina += "<p style='font-size:14px; color:#555;'>Clique abaixo para buscar o primeiro produto na sua conta Dropi e publicá-lo automaticamente no Mercado Livre.</p>";
    pagina += "<button class='btn btn-sync' onclick='sincronizar()'>Sincronizar Produto Dropi</button>";
    pagina += "<div id='msg-sync'></div></div>";

    pagina += "<script>async function sincronizar(){";
    pagina += "var m=document.getElementById('msg-sync');m.style.display='block';m.style.background='#e3f2fd';m.style.color='#1565c0';m.innerHTML='Varrendo catálogo Dropi de forma 100% automática...';";
    pagina += "try {";
    pagina += "  var r=await fetch('/sincronizar',{method:'POST'});";
    pagina += "  var res=await r.json();";
    pagina += "  if(res.ok){m.style.background='#e8f5e9';m.style.color='#2e7d32';m.innerHTML=res.msg + ' <br><br><a href=\"'+res.permalink+'\" target=\"_blank\">Ver Anúncio no ML</a>';}";
    pagina += "  else{m.style.background='#ffebee';m.style.color='#c62828';m.innerHTML='Erro: '+res.erro;}";
    pagina += "} catch(e) { m.innerHTML='Erro de conexão: '+e; }";
    pagina += "}<\/script>"; 
  }

  pagina += "</body></html>";
  res.send(pagina);
});

app.listen(PORT, () => {
  console.log(`Servidor rodando liso na porta ${PORT}`);
});
