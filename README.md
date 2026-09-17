# FisioLink — versão com vídeos reais

Esta versão usa **Supabase Auth + PostgreSQL + Storage**. O fisioterapeuta envia arquivos MP4/WebM e os pacientes autenticados veem os vídeos e registram conclusão.

## 1. Criar o Supabase
1. Crie um projeto no Supabase.
2. Abra **SQL Editor**.
3. Cole e execute todo o arquivo `supabase-setup.sql`.
4. Para uma apresentação rápida, em **Authentication > Providers > Email**, você pode desativar a confirmação obrigatória de e-mail. Em produção, mantenha confirmação e verificação profissional.

## 2. Configurar o site
Abra `config.js` e coloque os valores de **Project Settings > API**:

```js
window.FISIOLINK_CONFIG = {
  SUPABASE_URL: "https://SEU-PROJETO.supabase.co",
  SUPABASE_ANON_KEY: "SUA_CHAVE_PUBLICA_ANON"
};
```

Use somente a chave pública `anon`/`publishable`. Nunca coloque `service_role` no site.

## 3. Hospedar
Pode publicar direto no GitHub Pages. O site é estático, e os dados/vídeos ficam no Supabase.

## Fluxo para testar
1. Crie uma conta de **Fisioterapeuta**.
2. Entre e abra **Adicionar vídeo**.
3. Publique um MP4 ou WebM de até 200 MB.
4. Saia e crie uma conta de **Paciente**.
5. O vídeo aparecerá em **Vídeos**.
6. Abra, assista e clique em **Marcar como concluído**.
7. O progresso aparecerá em **Meu progresso**.

## Segurança do MVP
- Bucket de vídeos privado.
- URLs temporárias assinadas por 1 hora.
- Upload/exclusão restritos ao dono do arquivo.
- Paciente só altera o próprio progresso.
- O sistema não faz diagnóstico.

Antes de uso real em saúde, implemente verificação de registro profissional, termos/consentimento, política de privacidade/LGPD e revisão de segurança.
