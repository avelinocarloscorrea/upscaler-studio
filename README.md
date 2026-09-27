# Upscaler Studio

Aprimore imagens e vídeos com IA diretamente no navegador. O conteúdo é processado no dispositivo, sem cadastro e sem enviar arquivos para servidores.

## Recursos

- Ampliação de imagens e vídeos em 2× com comparação entre original e resultado.
- Modelos com opções de velocidade e nível de detalhe.
- Exportação PNG e MP4 com download local.
- Tema automático (claro/escuro), seleção manual e painéis translúcidos.
- Guia do usuário integrado.

## Desenvolvimento

Requer Node.js 22.15 ou superior.

```sh
npm install
npm run serve
```

## Publicar na Hostinger

O projeto gera um site estático; depois da compilação, não precisa manter um processo Node.js em execução. Na configuração de Node.js Web App da Hostinger, use Node.js 22 ou superior, `npm install`, `npm run build` e `dist` como diretório de saída. Deixe o comando de inicialização vazio.

O processamento requer WebGPU. Vídeos também usam WebCodecs. Chrome ou Edge atualizados em computador são recomendados; suporte depende do sistema, navegador e driver gráfico.

## Origem e licença

Este projeto é baseado no [Free AI Video Upscaler](https://github.com/sb2702/free-ai-video-upscaler) e usa o WebSR SDK. A licença MIT permite uso, modificação e redistribuição, desde que os avisos de copyright e o texto da licença original sejam mantidos. Consulte [LICENSE](LICENSE).

As fontes Arimo e Playfair Display estão sob SIL Open Font License 1.1; os avisos estão em `src/img/LICENSE-arimo.txt` e `src/img/LICENSE-playfair-display.txt`.
