# Upscaler Studio

Aprimore vídeos com IA diretamente no navegador. O processamento acontece no dispositivo, sem cadastro e sem enviar vídeos para servidores.

## Recursos

- Ampliação de vídeo em 2× com comparação entre original e resultado.
- Modelos com opções de velocidade e nível de detalhe.
- Exportação MP4 com salvamento local ou download.
- Tema automático (claro/escuro), seleção manual e painéis translúcidos.

## Executar localmente

Requer Node.js 22.15 ou superior.

```sh
npm install
npm run serve
```

## Publicar na Hostinger

Este projeto gera um site estático; não precisa manter um processo Node.js rodando depois do build.

Na configuração de Node.js Web App da Hostinger, escolha o tipo **Other** e informe:

- **Versão do Node.js:** 22 ou superior
- **Comando de instalação:** `npm install`
- **Comando de build:** `npm run build`
- **Diretório de saída:** `dist`
- **Entry file / comando de inicialização:** deixe vazio

A pasta `dist` contém o `index.html` e os arquivos compilados para publicação. O repositório também inclui `package-lock.json`; após remover as dependências antigas de Grunt, o `npm install` sincroniza o lockfile com `package.json` durante o deploy.

O projeto usa WebGPU, WebCodecs e a API de acesso a arquivos do navegador. Chrome ou Edge atualizados em computador são recomendados.

## Origem e licença

Este projeto é baseado no [Free AI Video Upscaler](https://github.com/sb2702/free-ai-video-upscaler) e usa o WebSR SDK. A licença MIT permite uso, modificação e redistribuição, desde que os avisos de copyright e o texto da licença original sejam mantidos. Consulte [LICENSE](LICENSE).

As fontes Arimo e Playfair Display estão sob SIL Open Font License 1.1; os avisos estão em `src/img/LICENSE-arimo.txt` e `src/img/LICENSE-playfair-display.txt`.
