# QA visual da jornada de amamentação

## Cobertura

O workflow captura diretamente da aplicação renderizada por Chromium em desktop e mobile:

- Tela de acesso, início, agenda, lista de pacientes e cadastro preenchido.
- Ficha da paciente e bebê (três famílias fictícias, sem uso de dados de produção).
- Atendimento completo (identificação, queixa, prontuário, avaliação materna, bebê, mamada, plano por quatro semanas e finalização).
- Exportação real do plano em PDF, conclusão, recarregamento, acompanhamento, financeiro, biblioteca, configurações e menu móvel.

## Execução e isolamento

Na branch qa/** ou por pull request, GitHub Actions usa Playwright e o backend local D1/Miniflare já existente no repositório. Nenhum secret, banco D1 remoto ou informação clínica real é utilizado. O workflow não faz deploy e não toca em migrações nem no Worker de produção.

O relatório inclui os prints em alta resolução e, ao final, os PDFs de orientações gerados diretamente pela aplicação. Os arquivos ficam disponíveis como artefato do run no GitHub Actions. Requer status verde da jornada para aprovar; falhas preservam capturas parciais para diagnóstico.

O núcleo é open source e não requer serviço pago. O uso de GitHub Actions respeita as cotas da conta.

## Reproduzir

npm ci
npm run build
npx playwright install chromium
npx playwright test --config=playwright.qa.config.mjs
python -m pip install reportlab pillow pypdf
python scripts/qa-visual-report.py

Saída: artifacts/qa-visual/qa-gestao-amamentacao-evidencias.pdf