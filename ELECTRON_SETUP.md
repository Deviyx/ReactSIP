# MicroSIP Desktop (Electron)

Esta é a versão **desktop nativa** do MicroSIP em React, construída com **Electron**.

## Vantagens sobre a versão web

✅ Acesso nativo a UDP/TCP para SIP (porta 5060)  
✅ Sem necessidade de WebSocket proxy  
✅ Apenas 3 campos obrigatórios: **usuário, domínio e senha**  
✅ Integração com o sistema operacional  
✅ Interface React bonita e responsiva  

## Instalação de dependências

```bash
npm install
```

Isso vai instalar:
- **Electron** - Framework para apps desktop
- **sip.js** - Biblioteca SIP nativa (para Node.js)
- **Concurrently** - Para rodar dev server e Electron em paralelo
- Todas as dependências React existentes

## Desenvolvimento

### Opção 1: Rodar Electron + Vite em paralelo

```bash
npm run electron-dev
```

Isso:
1. Inicia o Vite dev server em `http://localhost:5173`
2. Aguarda que esteja pronto
3. Abre a janela do Electron apontando para localhost
4. Hot reload funciona normalmente no React

### Opção 2: Rodar Vite e Electron separadamente

Terminal 1 (Vite dev server):
```bash
npm run dev
```

Terminal 2 (Electron):
```bash
npm run electron
```

## Build para produção

```bash
npm run electron-build
```

Isso:
1. Faz build do React com Vite
2. Empacota com Electron
3. Gera executável .exe (no Windows)

O executável estará em `dist/`

## Estrutura de arquivos

```
public/
├── electron.js          # Main process do Electron (Node.js)
├── preload.js           # Ponte segura entre Node.js e React
├── icon.png             # Ícone do aplicativo (opcional)

src/
├── hooks/
│   └── useSIP.js       # Hook que usa IPC para SIP (substituiu JsSIP)
└── ... (React components normais)
```

## Como funciona

1. **Main Process** (`electron.js` em Node.js)
   - Gerencia a janela
   - Expõe API SIP via IPC
   - Implementa protocolo SIP nativo

2. **Preload** (`preload.js`)
   - Expõe API segura com `contextBridge`
   - `window.electronAPI.sip.*()` disponível no React

3. **React Frontend**
   - Uses `useSIP()` hook
   - Chama `window.electronAPI.sip.connect()`, `.call()`, etc.
   - Recebe eventos via IPC listeners

## Próximos passos

1. ✅ Estrutura base do Electron criada
2. ⏳ Implementar SIP nativo em `electron.js` usando `sip.js`
3. ⏳ Testar conexão, chamadas e eventos
4. ⏳ Build e distribuição

## Remover campos desnecessários (Settings)

Como agora temos acesso nativo a SIP, você pode:
- **Remover** campos de `ws_servers_host` e `ws_servers_port`
- **Manter** apenas: usuário, senha, domínio, display name
- **Opcional**: portas SIP customizadas (mas padrão é 5060)
