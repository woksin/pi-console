import 'reflect-metadata';
import { createRoot } from 'react-dom/client';
import { useState, type FormEvent } from 'react';
import { Arc } from '@cratis/arc.react';
import { QueryTransportMethod } from '@cratis/arc/queries';
import { AddRow } from './generated/AddRow';
import { All } from './generated/All';

function Board() {
    const [command, setValues] = AddRow.use();
    const [result] = All.use();
    const [title, setTitle] = useState('');
    const [status, setStatus] = useState('');
    async function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setValues({ id: crypto.randomUUID(), title });
        const response = await command.execute();
        setStatus(response.isSuccess ? 'Appended' : 'Command failed');
        if (response.isSuccess) setTitle('');
    }
    return <main>
        <h1>Arc SQLite live rows (SSE)</h1>
        <form onSubmit={event => void submit(event)}>
            <input aria-label="Title" value={title} onChange={event => setTitle(event.target.value)} />
            <button type="submit">Append row</button>
        </form>
        <p role="status">{status}</p>
        <ul>{result.data.map(row => <li key={row.id}>{row.title}</li>)}</ul>
    </main>;
}

createRoot(document.getElementById('root')!).render(
    <Arc queryDirectMode queryTransportMethod={QueryTransportMethod.ServerSentEvents}><Board /></Arc>
);
