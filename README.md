# 🚨 API — Sistema de Alertas para Dependentes

API RESTful do sistema de monitoramento e alertas em tempo real para cuidadores e dependentes.

Hospedada no Render, a API centraliza autenticação, gestão de perfis, envio de notificações e o ciclo de vida dos alertas de emergência.

---

## 📐 Arquitetura Geral

```text
Cliente (React / Expo)
        │
        ▼
   API REST (Node.js / Express)
        │
        ├── Autenticação (JWT + bcrypt)
        ├── Notificações (Resend — e-mail)
        ├── Geocodificação (Nominatim)
        │
        ▼
 Banco de Dados (PostgreSQL / Supabase)
```

---

## 🛠️ Tecnologias

### Node.js

Ambiente de execução JavaScript no servidor. Toda a API é construída sobre Node.js utilizando Express.

```js
// server.js
import express from 'express';

const app = express();

app.use(express.json());

app.listen(3000, () => {
  console.log('API rodando na porta 3000');
});
```

### JavaScript (ES Modules)

O projeto utiliza módulos ES nativos (`import/export`) em toda a base de código.

```js
// routes/alerts.js
import { Router } from 'express';
import { createAlert } from '../controllers/alertController.js';

const router = Router();

router.post('/', createAlert);

export default router;
```

### bcrypt

Utilizado para armazenar senhas de forma segura através de hashing.

```js
import bcrypt from 'bcrypt';

const SALT_ROUNDS = 10;

// Ao criar usuário
const passwordHash = await bcrypt.hash(
  plainPassword,
  SALT_ROUNDS
);

// Ao fazer login
const isValid = await bcrypt.compare(
  plainPassword,
  storedHash
);

if (!isValid) {
  throw new Error('Credenciais inválidas');
}
```

### JWT (JSON Web Tokens)

Controle de autenticação stateless utilizando access token e refresh token.

```js
import jwt from 'jsonwebtoken';

// Gerar access token
const accessToken = jwt.sign(
  {
    profileId: profile.id,
    role: profile.role
  },
  process.env.JWT_SECRET,
  {
    expiresIn: '15m'
  }
);

// Middleware de autenticação
const verifyToken = (req, res, next) => {
  const token =
    req.headers.authorization?.split(' ')[1];

  try {
    req.user = jwt.verify(
      token,
      process.env.JWT_SECRET
    );

    next();
  } catch {
    res.status(401).json({
      error: 'Token inválido ou expirado'
    });
  }
};
```

### Resend

Serviço responsável pelo envio de e-mails transacionais.

```js
import { Resend } from 'resend';

const resend = new Resend(
  process.env.RESEND_API_KEY
);

await resend.emails.send({
  from: 'alertas@seudominio.com',
  to: carer.email,
  subject: '🚨 Alerta de emergência recebido',
  html: `
    <h2>Alerta de ${dependent.name}</h2>
    <p>Localização: ${alert.address}</p>
    <p>
      Emitido em:
      ${new Date(alert.emitted_at)
        .toLocaleString('pt-BR')}
    </p>
  `
});
```

### Nominatim (OpenStreetMap)

Serviço de geocodificação reversa utilizado para converter coordenadas GPS em endereços legíveis.

```js
const getAddress = async (
  latitude,
  longitude
) => {
  const url =
    `https://nominatim.openstreetmap.org/reverse` +
    `?lat=${latitude}` +
    `&lon=${longitude}` +
    `&format=json`;

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'SistemaAlertas/1.0'
    }
  });

  const data = await response.json();

  return data.display_name;
};
```

### Express Router

Organização modular das rotas da API utilizando o Router do Express.

```js
// app.js
import alertRoutes from './routes/alerts.js';
import profileRoutes from './routes/profiles.js';
import authRoutes from './routes/auth.js';

app.use('/api/auth', authRoutes);
app.use('/api/profiles', profileRoutes);
app.use('/api/alerts', alertRoutes);
```

### PostgreSQL via Supabase

Banco de dados relacional hospedado no Supabase.

```js
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const { data, error } = await supabase
  .from('alerts')
  .select('*')
  .eq('dependent_profile_id', profileId)
  .eq('status', 'pending');
```

---

## 🗄️ Modelagem do Banco de Dados

### Diagrama das Entidades Principais

```text
users (1) ──────< profiles (N)
                     │
          ┌──────────┴──────────┐
          │                     │
     [role=carer]         [role=dependent]
          │                     │
          └──< carer_dependent_links >──┘
                                │
                           alerts (N)
                                │
                    alert_notifications (N)
                                │
                          escalations
```

### Tabelas e Responsabilidades

| Tabela                | Responsabilidade                              |
| --------------------- | --------------------------------------------- |
| users                 | Conta de acesso (e-mail e senha hash)         |
| profiles              | Perfil de utilização do sistema               |
| carer_dependent_links | Relacionamento entre cuidadores e dependentes |
| devices               | Dispositivos registrados                      |
| device_tokens         | Tokens para notificações                      |
| alerts                | Registro dos alertas emitidos                 |
| alert_notifications   | Histórico das notificações enviadas           |
| escalations           | Escalonamentos para serviços de emergência    |
| refresh_tokens        | Sessões persistentes                          |
| relationships         | Relacionamentos simplificados                 |

### Ciclo de Vida de um Alerta

```text
pending
   │
   ▼
notified
   │
   ├──► acknowledged
   │          │
   │          ├──► resolved_carer
   │          └──► resolved_dependent
   │
   └──► escalated

cancelled
```

---

## 🔐 Variáveis de Ambiente

Crie um arquivo `.env` na raiz do projeto.

```env
# Servidor
PORT=3000
NODE_ENV=development

# Supabase
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# JWT
JWT_SECRET=sua-chave-secreta-longa-e-aleatoria
JWT_REFRESH_SECRET=outra-chave-secreta

# Resend
RESEND_API_KEY=re_xxxxxxxxxxxx

# Frontend
CLIENT_URL=https://seu-frontend.vercel.app
```

---

## 🚀 Como Rodar Localmente

```bash
# Instalar dependências
npm install

# Configurar variáveis de ambiente
cp .env.example .env

# Executar em desenvolvimento
npm run dev
```

A API ficará disponível em:

```text
http://localhost:3000
```

---

## 📡 Principais Endpoints

| Método | Endpoint                      | Descrição                      |
| ------ | ----------------------------- | ------------------------------ |
| POST   | `/api/auth/register`          | Cria usuário e perfil inicial  |
| POST   | `/api/auth/login`             | Realiza autenticação           |
| POST   | `/api/auth/refresh`           | Renova access token            |
| GET    | `/api/profiles/:id`           | Busca perfil                   |
| POST   | `/api/alerts`                 | Emite alerta de emergência     |
| PATCH  | `/api/alerts/:id/acknowledge` | Confirma recebimento           |
| PATCH  | `/api/alerts/:id/resolve`     | Marca alerta como resolvido    |
| GET    | `/api/alerts/:dependentId`    | Lista alertas de um dependente |

---

## ☁️ Deploy (Render)

A API é hospedada no Render como um Web Service.

```text
Build Command: npm install
Start Command: npm start
```

Características:

* Deploy integrado ao GitHub
* Configuração de variáveis de ambiente pelo painel do Render
* Reinício automático em caso de falha
* Logs centralizados para monitoramento

---

## 📁 Estrutura do Projeto

```text
api/
├── src/
│   ├── controllers/
│   │   ├── authController.js
│   │   ├── alertController.js
│   │   └── profileController.js
│   │
│   ├── middlewares/
│   │   ├── authMiddleware.js
│   │   └── errorHandler.js
│   │
│   ├── routes/
│   │   ├── auth.js
│   │   ├── alerts.js
│   │   └── profiles.js
│   │
│   ├── services/
│   │   ├── notificationService.js
│   │   └── geocodingService.js
│   │
│   └── lib/
│       └── supabase.js
│
├── .env.example
├── server.js
└── package.json
```
