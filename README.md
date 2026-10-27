# Slideshow iCloud para iPad mini 2

```
worker/   Cloudflare Worker: lê o álbum do iCloud e devolve JSON com as URLs (~2048 px)
site/     Página PWA estática (GitHub Pages): slideshow, transições, modo quiosque
```

## 1. Álbum do iCloud

No iPhone/Mac: Fotos → álbum compartilhado → Pessoas → ative **Site Público**.
O link fica assim: `https://www.icloud.com/sharedalbum/#B0aBcDeFgHiJkL`.
O código é o que vem depois do `#` (`B0aBcDeFgHiJkL`).

## 2. Publicar o Worker

Precisa de uma conta gratuita na Cloudflare.

```bash
cd worker
npm install
npx wrangler login
npx wrangler secret put ALBUM_TOKEN
npx wrangler deploy
```

- `secret put` pede o código do álbum. Ele fica só na Cloudflare, nunca no código da página.
- O `deploy` mostra a URL, algo como `https://icloud-slideshow.SEU-SUBDOMINIO.workers.dev`.
- Teste no navegador do computador: a URL deve devolver `{"album": ..., "count": N, "photos": [...]}`.
  Use `?fresh=1` para ignorar o cache de 5 minutos.

Depois que o site estiver no ar, restrinja o acesso: em `wrangler.toml`, troque
`ALLOWED_ORIGIN = "*"` por `ALLOWED_ORIGIN = "https://SEU-USUARIO.github.io"` e rode `npx wrangler deploy` de novo.

**Teste local:** crie `worker/.dev.vars` com `ALBUM_TOKEN=SEU_CODIGO` e rode `npx wrangler dev`
(o arquivo `.dev.vars` está no `.gitignore`).

## 3. Publicar a página (GitHub Pages)

1. Em `site/config.js`, coloque a URL do Worker em `workerUrl`.
2. Crie um repositório no GitHub e envie o projeto:
   ```bash
   git init
   git add .
   git commit -m "Slideshow iCloud"
   git branch -M main
   git remote add origin https://github.com/SEU-USUARIO/ipad-slideshow.git
   git push -u origin main
   ```
3. No GitHub: **Settings → Pages → Build and deployment → Deploy from a branch**,
   branch `main`, pasta `/ (root)`. A página fica em
   `https://SEU-USUARIO.github.io/ipad-slideshow/site/`.
   (Se preferir a página na raiz da URL, mova o conteúdo de `site/` para um repositório só dele.)

**Ao alterar a página**, aumente `cacheVersion` em `site/config.js` (`v1` → `v2`) antes do push,
para o service worker baixar os arquivos novos. A versão nova aparece na segunda abertura.

## 4. Instalar e testar no iPad

1. Abra a URL no **Safari** do iPad e confira se as fotos aparecem.
2. Compartilhar → **Adicionar à Tela de Início**. Abra pelo ícone (tela cheia, sem barra do Safari).
3. **Toque uma vez** na tela: isso liga o vídeo invisível que impede a tela de apagar (NoSleep).
4. Ajustes → Tela e Brilho → **Bloqueio Automático: Nunca**.
5. Ajustes → Acessibilidade → **Acesso Guiado**: ative; abra o slideshow e toque 3× no botão
   de Início para iniciar.

Para depurar: conecte o iPad a um Mac, ative Ajustes → Safari → Avançado → Web Inspector e use
Safari (Mac) → Desenvolver → iPad. No Windows não há inspetor do iOS; use o texto de status
que aparece no centro da tela.

## Configurações

Toque na tela → aparece a engrenagem no canto inferior direito (some em 5 s).
- Tempo por foto, duração da transição, ordem (aleatória, sequencial, mais novas primeiro).
- Efeitos ligados/desligados.
- Horário de escurecimento e intensidade; intervalo de recarga automática.

Ficam salvas no próprio iPad. Também dá para passar na URL, por exemplo:
`index.html?interval=20&effects=fade,kenburns,iris&order=sequential`.

## Como funciona

- `GET /` no Worker chama `webstream`, segue o redirecionamento 330 (`X-Apple-MMe-Host`),
  escolhe a maior versão com até ~2048 px e devolve só a lista (id + checksum), com cache de 10 min.
  Num álbum grande (~1600 fotos) a consulta sem cache leva ~50 s; a página continua exibindo nesse tempo.
- `GET /photo?id=…&c=…` resolve a URL de uma foto via `webasseturls` na hora de exibir e
  redireciona para ela. As URLs do iCloud expiram em ~20 min, por isso não vão na lista.
  Vídeos do álbum são ignorados.
- A página mantém no máximo 2 imagens na memória (a atual e a próxima, pré-carregada).
  Persianas e mosaico reaproveitam a mesma imagem já decodificada.
- A cada 10 min a lista é atualizada sem interromper a exibição; fotos novas entram na frente da fila.
- Se uma foto falhar (removida do álbum, rede), a página pede uma lista nova e pula para a próxima.
- Offline: a página guarda no iPad (IndexedDB) as últimas 40 fotos exibidas, reduzidas para 1024 px
  (~4 MB). Se a internet cair, o slideshow continua com elas e volta ao álbum quando a conexão voltar.
  A página abre sem internet pelo AppCache (`site/offline.appcache`, iOS 9) ou pelo service worker
  (navegadores novos). Ao publicar mudanças, altere `cacheVersion` em `config.js` **e** a linha `# vN`
  do `offline.appcache`.
- As fotos passam pelo Worker (`/photo?...&raw=1`, com CORS e cache de 7 dias na Cloudflare);
  é isso que permite à página copiá-las para a reserva.

## Limitações

- O endpoint do site público do iCloud não é oficial e pode mudar sem aviso; se parar,
  o ajuste fica concentrado em `worker/src/index.js`.
- No iOS 12 o vídeo NoSleep só começa depois de um toque. Com Bloqueio Automático em
  "Nunca" ele é só uma garantia extra.
