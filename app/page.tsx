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
    
    fetch('/api/user/fetch')
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

    const res = await fetch('/api/user/update', {
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

  async function fetchUsers(){
    fetch('api/users/fetch')
    .then(res => {return res.json()})
    .then(data => {console.log(data)})
  }

  async function handleCreatePlan() {
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      console.error("User not logged in")
      return
    }

    // Test data for creating a plan
    const planData = {
      title: "Test Savings Plan",
      schedule: "monthly",
      total_amount: 10000,
      per_payout_amount: 1000,
      wallet_to_send_to: "ABC123DEF456",
      start_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() // 7 days from now
    }

    try {
      const res = await fetch('/api/plans/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(planData)
      })

      const data = await res.json()
      
      if (res.ok) {
        console.log('Plan created successfully:', data)
      } else {
        console.error('Error creating plan:', data)
      }
    } catch (error) {
      console.error('Network error:', error)
    }
  }

  async function fetchPlans() {
    fetch('api/plans/fetch')
    .then(res => {return res.json()})
    .then(data => {console.log(data)})
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

      <button
        className="bg-white text-black p-2"
        onClick={fetchUsers}
      >
        fetch users
      </button>

      <button
        className="bg-green-500 text-white p-2 hover:bg-green-600"
        onClick={handleCreatePlan}
      >
        create plan
      </button>

      <button
        className="bg-purple-500 text-white p-2 hover:bg-green-600"
        onClick={fetchPlans}
      >
        fetch plans
      </button>
    </div>
  )
}