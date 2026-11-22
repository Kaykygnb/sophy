type Session = {
  clientId: string | null;
  close: () => void;
};

const sessions = new Set<Session>();

/** Liga uma sessão MCP aberta ao cliente. `clientId` nulo é o modo legado. */
export function openSession(clientId: string | null, close: () => void) {
  const session: Session = { clientId, close };
  sessions.add(session);
  return () => {
    sessions.delete(session);
  };
}

export function dropClientSessions(clientId: string) {
  for (const session of [...sessions]) {
    if (session.clientId !== clientId) continue;
    sessions.delete(session);
    try {
      session.close();
    } catch {
      /* a sessão já tinha caído */
    }
  }
}

export function dropLegacySessions() {
  for (const session of [...sessions]) {
    if (session.clientId !== null) continue;
    sessions.delete(session);
    try {
      session.close();
    } catch {
      /* a sessão já tinha caído */
    }
  }
}

/** Fecha sessões cujo cliente foi revogado, desativado, ou cujo legado foi desligado. */
export function reconcileSessions(aliveClientIds: ReadonlySet<string>, legacyOn: boolean) {
  for (const session of [...sessions]) {
    const dead =
      session.clientId === null ? !legacyOn : !aliveClientIds.has(session.clientId);
    if (!dead) continue;
    sessions.delete(session);
    try {
      session.close();
    } catch {
      /* a sessão já tinha caído */
    }
  }
}
