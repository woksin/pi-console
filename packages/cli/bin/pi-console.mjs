#!/usr/bin/env node
import process from 'node:process';
import { runCli } from '../src/main.ts';

process.exitCode = await runCli(process.argv.slice(2));
