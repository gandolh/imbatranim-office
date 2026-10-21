// Named imports, and the jsx/jsxs/Fragment imports the JSX transform writes.
import { createContext, useState } from 'react'

export const refs = { useState, createContext }

export function Hello() {
  return (
    <>
      <b>hi</b>
      <i>there</i>
    </>
  )
}
