import { useEffect, useState } from "react";
import { health } from "@airepetitor/contract/client";

export function App() {
  const [status, setStatus] = useState("loading");

  useEffect(() => {
    health()
      .then((res) => setStatus(res.data.status))
      .catch(() => setStatus("unreachable"));
  }, []);

  return <main>API status: {status}</main>;
}
