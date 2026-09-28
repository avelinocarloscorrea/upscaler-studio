# Documentação do Upscaler Studio

Última revisão: 27/09/2026

## 1. O que o projeto faz

O Upscaler Studio é uma aplicação estática para ampliar imagens e vídeos no navegador. A ampliação padrão é de 2×. A tela permite comparar o original com o resultado e salvar a saída como PNG ou MP4.

O repositório é público: <https://github.com/avelinocarloscorrea/upscaler-studio>. A versão pública fica em <https://upscalerstudio.esmeraldapaper.com.br/>. O endereço curto solicitado para o site principal é <https://www.esmeraldapaper.com.br/upscalerstudio/>; sua configuração e a inclusão no WordPress dependem da publicação no Hostinger.

## 2. Privacidade e fluxo dos arquivos

A ferramenta não tem servidor de processamento, cadastro, banco de dados de mídia ou endpoint de envio. Não há chamadas a `fetch`, `XMLHttpRequest`, `WebSocket` ou `sendBeacon` no código da aplicação revisado nesta versão.

O fluxo de mídia é local:

1. O navegador abre o seletor nativo de arquivos.
2. O arquivo permanece como `File` na memória da aba.
3. Imagens são lidas com `createImageBitmap`; vídeos são exibidos por URL `blob:` temporária.
4. O worker local usa WebGPU e os pesos incluídos no pacote para produzir a imagem ampliada.
5. Para vídeo, a ferramenta usa WebCodecs e o demuxer incluído no build.
6. O resultado é entregue como `Blob` local para salvar pelo navegador. URLs `blob:` temporárias são revogadas ao trocar a mídia.

Preferências de aparência, como tema e visibilidade dos painéis, podem ser guardadas no `localStorage`. Nenhuma imagem ou vídeo é persistida por essa preferência.

### Conexões de rede

Na primeira visita, o navegador baixa o HTML, JavaScript, fontes, pesos e WebAssembly do próprio domínio do Upscaler. O cabeçalho CSP permite recursos da própria origem e URLs `blob:` necessárias ao processamento. O app não carrega fontes, modelos ou bibliotecas de terceiros em tempo de execução.

Os links para Esmeralda Paper, avaliação, política de privacidade e GitHub são links comuns. Eles só abrem quando a pessoa clica. A página do WordPress deve apontar para o app com um link externo simples: sem `iframe`, script compartilhado, API, pixel ou envio automático de dados.

## 3. Arquitetura

- `src/index.html` e `src/index.css`: interface e layout responsivo.
- `src/index.ts`: interação, escolha da mídia, prévia, comparação e exportação.
- `src/worker.ts`: processamento isolado em Web Worker.
- `src/processors/`: pipeline de mídia, demux e armazenamento temporário.
- `src/weights/`: pesos dos modelos distribuídos dentro do pacote.
- `src/guia.html` e `src/guia.css`: guia do usuário que acompanha o build.
- `src/img/`: marca, fontes e avisos de licença.
- `webpack.config.js`: gera a pasta estática `dist/`, usa nome versionado no JavaScript para evitar código antigo em cache e copia WebAssembly, documentos e regras de cabeçalho do Hostinger (`hostinger.htaccess`).

## 4. Tipos de mídia e requisitos

- Imagens: PNG, JPEG, WebP, AVIF, BMP e GIF.
- Vídeo: MP4.
- Cada lado da imagem pode ter até 4096 px para o fluxo de ampliação.
- WebGPU é necessário para a ampliação.
- WebCodecs é necessário para o fluxo de vídeo.
- Chrome ou Edge atuais em computador são recomendados. Disponibilidade real depende do navegador, sistema e driver gráfico.

## 5. Desenvolvimento e publicação

Requisitos: Node.js 22.15 ou superior e npm.

```sh
npm install
npm run serve
```

Para gerar os arquivos de produção:

```sh
npm run build
npm run type-check
```

O resultado publicável está em `dist/`. No Hostinger Node.js Web App, a aplicação usa Node 22 ou superior, `npm install`, `npm run build` e `dist` como diretório de saída. Como o resultado é estático, não há comando de inicialização nem processo Node persistente.

As dependências antigas `grunt-cloudfront` e Grunt foram removidas do `package.json` e do lockfile: `grunt-cloudfront@0.1.0` exigia Grunt 0.4 e causava `ERESOLVE`. Não use `--force` nem `--legacy-peer-deps` para instalar este projeto.

## 6. Segurança revisada

- A CSP bloqueia origens externas para scripts, conexão, imagem, mídia, fontes e frames; mantém `self` e `blob:` onde o app precisa.
- `frame-ancestors 'none'` impede que a ferramenta seja incorporada em outro site.
- Os nomes e tipos de arquivo são validados antes do processamento; SVG não é aceito como imagem.
- Links que abrem outra origem usam `rel="noopener noreferrer"`.
- A busca no código desta revisão não encontrou `innerHTML`, `outerHTML`, `eval`, `new Function` nem APIs de envio de mídia.
- A verificação de vulnerabilidades conhecidas nas dependências de produção não reportou alertas.
- Build de produção e checagem TypeScript concluíram sem erros.

A ferramenta não pode proteger contra extensões maliciosas do navegador, sistema operacional comprometido, malware no dispositivo ou alterações futuras no código. A afirmação de processamento local descreve o comportamento do código e do build revisados; alterações devem repetir as verificações antes de publicar.

O build usa um nome com hash para o JavaScript e publica cabeçalhos que evitam manter uma versão antiga do HTML no cache do navegador.

## 7. WordPress e isolamento

A página de ferramentas do WordPress deve exibir apenas descrição, ícone e links para abrir o app, guia e código-fonte. Não incorporar o app em `iframe`, não carregar seus scripts no WordPress e não transmitir arquivos entre domínios. A página pública apresenta um link externo simples para abrir a ferramenta.

O caminho curto `/upscalerstudio/` redireciona para o subdomínio independente. Isso separa a aplicação estática do WordPress e evita dependências de plugins, banco de dados ou APIs do site de papelaria durante o uso do Upscaler.

## 8. Licenças e créditos

O projeto mantém a licença MIT e avisos da aplicação original. As fontes Arimo e Playfair Display são distribuídas sob SIL Open Font License 1.1, com os avisos em `src/img/`.


