# Upscaler Studio

Aprimore vídeos com IA diretamente no navegador. O processamento acontece no dispositivo, sem cadastro e sem enviar vídeos para servidores.

## Recursos

- Ampliação de vídeo em 2× com comparação entre original e resultado.
- Modelos com opções de velocidade e nível de detalhe.
- Exportação MP4 com salvamento local ou download.
- Tema automático (claro/escuro), seleção manual e painéis translúcidos.

## Desenvolvimento

```sh
npm install
npm run serve
```

O projeto usa WebGPU, WebCodecs e a API de acesso a arquivos do navegador. Chrome ou Edge atualizados em computador são recomendados.

## Origem e licença

Este projeto é baseado no [Free AI Video Upscaler](https://github.com/sb2702/free-ai-video-upscaler) e usa o WebSR SDK. A licença MIT permite uso, modificação e redistribuição, desde que os avisos de copyright e o texto da licença original sejam mantidos. Consulte [LICENSE](LICENSE).

As fontes Arimo e Playfair Display estão sob SIL Open Font License 1.1; os avisos estão em `src/img/LICENSE-arimo.txt` e `src/img/LICENSE-playfair-display.txt`.
