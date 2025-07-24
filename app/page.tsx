"use client"

import createClient from "@/lib/supabase/client"

export default function Home() {
  const supabase = createClient()

  async function handlePost() {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback`
      }
    })
  }

  async function handleGet() {
    
    fetch('/api/users/fetch')
      .then(res => res.json())
      .then(data => {
        console.log('Fetched user data:', data)
      })
  }

  async function handlePatch() {
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      console.error("User not logged in")
      return
    }

    const res = await fetch('/api/users/update', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: "Justin RePatched",
        phone_number: "+234000000000",
        is_verified: true,
        picture: "https://example.com/updatedProfile.jpg"
      })
    })

    const data = await res.json()
    console.log('Patch response:', data)
  }

  return (
    <div className="font-sans grid grid-rows-[20px_1fr_20px] items-center justify-items-center min-h-screen p-8 pb-20 gap-16 sm:p-20">
      <p>checking out stuff</p>

      <button
        className="bg-white text-black p-2"
        onClick={handlePost}
      >
        trigger post
      </button>

      <button
        className="bg-white text-black p-2"
        onClick={handleGet}
      >
        trigger get
      </button>

      <button
        className="bg-white text-black p-2"
        onClick={handlePatch}
      >
        trigger patch
      </button>
    </div>
  )
}
